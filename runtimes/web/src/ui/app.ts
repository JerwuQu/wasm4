import { LitElement, html, css } from "lit";
import { customElement, state, query } from 'lit/decorators.js';

import * as constants from "../constants";
import * as devkit from "../devkit";
import * as utils from "./utils";
import * as z85 from "../z85";
import { Runtime } from "../runtime";
import { State } from "../state";

import { MenuOverlay } from "./menu-overlay";

import { Netplay } from "../netplay";

const DEV_NETPLAY = false;

class InputState {
    gamepad = [0, 0, 0, 0];
    mouseX = 0;
    mouseY = 0;
    mouseButtons = 0;
}

// TODO(2022-03-19): Remove
class InputManager {
    /** The input to be used for the next frame. */
    nextState = new InputState();

    /** The input used from the last frame. */
    lastState = new InputState();

    update () {
        const next = this.nextState;
        const last = this.lastState;

        // Copy the next input state into the last input state
        for (let ii = 0; ii < 4; ++ii) {
            last.gamepad[ii] = next.gamepad[ii];
        }
        last.mouseX = next.mouseX;
        last.mouseY = next.mouseY;
        last.mouseButtons = next.mouseButtons;
    }
}

@customElement("wasm4-app")
export class App extends LitElement {
    static styles = css`
        :host {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;

            touch-action: none;
            user-select: none;
            -webkit-user-select: none;
            -webkit-tap-highlight-color: transparent;

            background: #202020;
        }

        .content {
            width: 100vmin;
            height: 100vmin;
            overflow: hidden;
        }

        /** Nudge the game upwards a bit in portrait to make space for the virtual gamepad. */
        @media (pointer: coarse) and (max-aspect-ratio: 2/3) {
            .content {
                position: absolute;
                top: calc((100% - 220px - 100vmin)/2)
            }
        }

        .content canvas {
            width: 100%;
            height: 100%;
            image-rendering: pixelated;
            image-rendering: crisp-edges;
        }
    `;

    readonly runtime: Runtime;
    screenshot?: string;

    @state() hideGamepadOverlay = false;

    @state() pauseMenu = false;

    @query("wasm4-menu-overlay") menuOverlay?: MenuOverlay;

    private savedGameState?: State;

    readonly inputManager = new InputManager();

    private netplay?: Netplay;

    constructor () {
        super();

        const qs = new URL(document.location.href).searchParams;
        const title = qs.get("title");
        const diskName = (document.getElementById("wasm4-disk-prefix")?.textContent ?? qs.get('disk-prefix') ?? title) + "-disk";
        this.runtime = new Runtime(diskName);

        this.init();
    }

    async init () {
        const qs = new URL(document.location.href).searchParams;

        async function loadCartWasm (): Promise<Uint8Array> {
            const cartJson = document.getElementById("wasm4-cart-json");

            // Is cart inlined?
            if (cartJson) {
                const { WASM4_CART, WASM4_CART_SIZE } = JSON.parse(cartJson.textContent ?? '');

                // The cart was bundled in the html, decode it
                const buffer = new Uint8Array(WASM4_CART_SIZE);
                z85.decode(WASM4_CART, buffer);
                return buffer;

            } else {
                // Load the cart from a url
                const cartUrl = qs.has("url") ? qs.get("url")! : "cart.wasm";
                const res = await fetch(cartUrl);
                return new Uint8Array(await res.arrayBuffer());
            }
        }

        const screenshot = qs.get("screenshot");
        if (screenshot) {
            this.screenshot = screenshot;
        }

        const runtime = this.runtime;
        await runtime.init();

        const canvas = runtime.canvas;

        if (DEV_NETPLAY && location.hash) {
            const hostPeerId = location.hash.substring(1);
            this.netplay = new Netplay(runtime);
            this.netplay.join(hostPeerId);

        } else {
            await runtime.load(await loadCartWasm());
        }

        let devtoolsManager = {
            toggleDevtools () {
                // Nothing
            },
            updateCompleted (...args: unknown[]) {
                // Nothing
            },
        };
        if (DEVELOPER_BUILD) {
            devtoolsManager = await import('@wasm4/web-devtools').then(({ DevtoolsManager}) => new DevtoolsManager())
        }

        if (!this.netplay) {
            runtime.start();
        }

        if (DEVELOPER_BUILD) {
            devkit.websocket?.addEventListener("message", async event => {
                switch (event.data) {
                case "reload":
                    this.resetCart(await loadCartWasm());
                    break;
                }
            });
        }

        function takeScreenshot () {
            // We need to render a frame first
            runtime.composite();

            canvas.toBlob(blob => {
                const url = URL.createObjectURL(blob!);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = "wasm4-screenshot.png";
                anchor.click();
                URL.revokeObjectURL(url);
            });
        }

        let videoRecorder: MediaRecorder | null = null;
        function recordVideo () {
            if (videoRecorder != null) {
                return; // Still recording, ignore
            }

            const mimeType = "video/webm";
            const videoStream = canvas.captureStream();
            videoRecorder = new MediaRecorder(videoStream, {
                mimeType,
                videoBitsPerSecond: 25000000,
            });

            const chunks: Blob[] = [];
            videoRecorder.ondataavailable = event => {
                chunks.push(event.data);
            };

            videoRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = "wasm4-animation.webm";
                anchor.click();
                URL.revokeObjectURL(url);
            };

            videoRecorder.start();
            setTimeout(() => {
                if(videoRecorder) {
                    videoRecorder.requestData();
                    videoRecorder.stop();
                    videoRecorder = null;
                }
            }, 4000);
        }

        // Temporary hack to allow developers to build 3-4 player games until we have a better solution
        let swapKeyboardControls = false;
        function toggleSwapKeyboardControls () {
            swapKeyboardControls = !swapKeyboardControls;
            runtime.print(`Keyboard swapped to control gamepads ${swapKeyboardControls ? "3 and 4" : "1 and 2"}`);
        }

        const onMouseEvent = (event: PointerEvent) => {
            // Unhide the cursor if it was hidden by the keyboard handler
            document.body.style.cursor = "";

            if (event.isPrimary) {
                const bounds = canvas.getBoundingClientRect();
                const input = this.inputManager.nextState;
                input.mouseX = Math.fround(constants.WIDTH * (event.clientX - bounds.left) / bounds.width);
                input.mouseY = Math.fround(constants.HEIGHT * (event.clientY - bounds.top) / bounds.height);
                input.mouseButtons = event.buttons & 0b111;
            }
        };
        window.addEventListener("pointerdown", onMouseEvent);
        window.addEventListener("pointerup", onMouseEvent);
        window.addEventListener("pointermove", onMouseEvent);

        canvas.addEventListener("contextmenu", event => {
            event.preventDefault();
        });

        const HOTKEYS: Record<string, (...args:any[]) => any> = {
            "2": this.saveGameState.bind(this),
            "4": this.loadGameState.bind(this),
            "r": this.resetCart.bind(this),
            "R": this.resetCart.bind(this),
            "F7": toggleSwapKeyboardControls,
            "F8": devtoolsManager.toggleDevtools,
            "F9": takeScreenshot,
            "F10": recordVideo,
            "F11": utils.requestFullscreen,
            "Enter": this.onMenuButtonPressed.bind(this),
        };

        const onKeyboardEvent = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.altKey) {
                return; // Ignore ctrl/alt modified key presses because they may be the user trying to navigate
            }

            if (event.srcElement instanceof HTMLElement && event.srcElement.tagName == "INPUT") {
                return; // Ignore if we have an input element focused
            }

            const down = (event.type == "keydown");

            // Poke WebAudio
            runtime.unlockAudio();

            // We're using the keyboard now, hide the mouse cursor for extra immersion
            document.body.style.cursor = "none";

            if (down) {
                const hotkeyFn = HOTKEYS[event.key];
                if (hotkeyFn) {
                    hotkeyFn();
                    event.preventDefault();
                    return;
                }
            }

            let playerIdx = 0;
            let mask = 0;
            switch (event.code) {
            case "KeyX": case "KeyV": case "Space": case "KeyM":
                mask = constants.BUTTON_X;
                break;
            case "KeyZ": case "KeyC": case "KeyN":
                mask = constants.BUTTON_Z;
                break;
            case "ArrowUp":
                mask = constants.BUTTON_UP;
                break;
            case "ArrowDown":
                mask = constants.BUTTON_DOWN;
                break;
            case "ArrowLeft":
                mask = constants.BUTTON_LEFT;
                break;
            case "ArrowRight":
                mask = constants.BUTTON_RIGHT;
                break;

            case "ShiftLeft": case "Tab":
                playerIdx = 1;
                mask = constants.BUTTON_X;
                break;
            case "KeyA": case "KeyQ":
                playerIdx = 1;
                mask = constants.BUTTON_Z;
                break;
            case "KeyE":
                playerIdx = 1;
                mask = constants.BUTTON_UP;
                break;
            case "KeyD":
                playerIdx = 1;
                mask = constants.BUTTON_DOWN;
                break;
            case "KeyS":
                playerIdx = 1;
                mask = constants.BUTTON_LEFT;
                break;
            case "KeyF":
                playerIdx = 1;
                mask = constants.BUTTON_RIGHT;
                break;
            }

            if (mask != 0) {
                event.preventDefault();

                if (swapKeyboardControls) {
                    playerIdx += 2;
                }

                // Set or clear the button bit from the next input state
                const gamepad = this.inputManager.nextState.gamepad;
                if (down) {
                    gamepad[playerIdx] |= mask;
                } else {
                    gamepad[playerIdx] &= ~mask;
                }
            }
        };
        window.addEventListener("keydown", onKeyboardEvent);
        window.addEventListener("keyup", onKeyboardEvent);

        // Also listen to the top frame when we're embedded in an iframe
        if (top && top != window) {
            top.addEventListener("keydown", onKeyboardEvent);
            top.addEventListener("keyup", onKeyboardEvent);
        }

        const pollPhysicalGamepads = () => {
            if (!navigator.getGamepads) {
                return; // Browser doesn't support gamepads
            }

            for (const gamepad of navigator.getGamepads()) {
                if (gamepad == null || gamepad.mapping != "standard") {
                    continue; // Disconnected or non-standard gamepad
                }

                // https://www.w3.org/TR/gamepad/#remapping
                const buttons = gamepad.buttons;
                const axes = gamepad.axes;

                let mask = 0;
                if (buttons[12].pressed || axes[1] < -0.5) {
                    mask |= constants.BUTTON_UP;
                }
                if (buttons[13].pressed || axes[1] > 0.5) {
                    mask |= constants.BUTTON_DOWN;
                }
                if (buttons[14].pressed || axes[0] < -0.5) {
                    mask |= constants.BUTTON_LEFT;
                }
                if (buttons[15].pressed || axes[0] > 0.5) {
                    mask |= constants.BUTTON_RIGHT;
                }
                if (buttons[0].pressed) {
                    mask |= constants.BUTTON_X;
                }
                if (buttons[1].pressed) {
                    mask |= constants.BUTTON_Z;
                }

                this.inputManager.nextState.gamepad[gamepad.index % 4] = mask;
            }
        }

        // https://gist.github.com/addyosmani/5434533#file-limitloop-js-L60
        const INTERVAL = 1000 / 60;

        let lastFrame = performance.now();

        // used for keeping a consistent framerate. not a real time.
        let lastFrameGapCorrected = lastFrame;

        if (DEV_NETPLAY && !location.hash) {
            this.copyNetplayLink(); // temporary during development
        }

        const loop = () => {
            pollPhysicalGamepads();

            const lastInput = this.inputManager.lastState;
            const input = this.inputManager.nextState;

            if (this.menuOverlay != null) {
                // Send buttons that were pressed this frame to the menu overlay
                for (let playerIdx = 0; playerIdx < 4; ++playerIdx) {
                    const pressed = input.gamepad[playerIdx] & (input.gamepad[playerIdx] ^ lastInput.gamepad[playerIdx]);
                    if (pressed) {
                        this.menuOverlay.onGamepadPressed(pressed);
                    }
                }

            } else {
                const now = performance.now();
                const deltaFrameGapCorrected = now - lastFrameGapCorrected;

                if (!this.pauseMenu && deltaFrameGapCorrected >= INTERVAL) {
                    const deltaTime = now - lastFrame;
                    lastFrame = now;
                    lastFrameGapCorrected = now - (deltaFrameGapCorrected % INTERVAL);

                    if (this.netplay) {
                        this.netplay.update(input.gamepad[0]);

                    } else {
                        // Pass inputs into runtime memory
                        for (let playerIdx = 0; playerIdx < 4; ++playerIdx) {
                            runtime.setGamepad(playerIdx, input.gamepad[playerIdx]);
                        }
                        runtime.setMouse(input.mouseX, input.mouseY, input.mouseButtons);

                        runtime.update();
                    }

                    runtime.composite();

                    this.hideGamepadOverlay = !!runtime.getSystemFlag(constants.SYSTEM_HIDE_GAMEPAD_OVERLAY);

                    if (DEVELOPER_BUILD) {
                        devtoolsManager.updateCompleted(runtime, deltaTime);
                    }
                }
            }

            this.inputManager.update();

            requestAnimationFrame(loop);
        };
        loop();
    }

    onPointerUp (event: PointerEvent) {
        if (event.pointerType == "touch") {
            // Try to go fullscreen on mobile
            utils.requestFullscreen();
        }

        // Try to begin playing audio
        this.runtime.unlockAudio();
    }

    onMenuButtonPressed () {
        if (this.pauseMenu) {
            // If the pause menu is already open, treat it as an X button
            this.inputManager.nextState.gamepad[0] |= constants.BUTTON_X;
        } else {
            this.pauseMenu = true;
        }
    }

    closeMenu () {
        if (this.pauseMenu) {
            this.pauseMenu = false;

            // Kind of a hack to prevent the button press to close the menu from being passed
            // through to the game
            for (let playerIdx = 0; playerIdx < 4; ++playerIdx) {
                this.inputManager.nextState.gamepad[playerIdx] = 0;
            }
        }
    }

    saveGameState () {
        let state = this.savedGameState;
        if (state == null) {
            state = this.savedGameState = new State();
        }
        state.read(this.runtime);
    }

    loadGameState () {
        const state = this.savedGameState;
        if (state != null) {
            state.write(this.runtime);
        }
    }

    copyNetplayLink () {
        if (!this.netplay) {
            this.netplay = new Netplay(this.runtime);
            this.netplay.host();
        }

        const url = this.netplay.getInviteLink();
        if (navigator.share) {
            navigator.share({ url });
        } else {
            utils.copyToClipboard(url);
            // TODO(2022-03-31): Show a notification about the URL being copied to the clipboard
        }

        console.log("Copy invite URL: "+url);
    }

    async resetCart (wasmBuffer?: Uint8Array) {
        if (!wasmBuffer) {
            wasmBuffer = this.runtime.wasmBuffer!;
        }

        this.runtime.reset(true);
        this.runtime.pauseState |= constants.PAUSE_REBOOTING;
        await this.runtime.load(wasmBuffer);
        this.runtime.start();
        this.runtime.pauseState &= ~constants.PAUSE_REBOOTING;
    }

    render () {
        return html`
            <div class="content" @pointerup="${this.onPointerUp}">
                ${this.pauseMenu ? html`<wasm4-menu-overlay .app=${this} />`: ""}
                ${this.runtime.canvas}
            </div>
            ${!this.hideGamepadOverlay ? html`<wasm4-virtual-gamepad .app=${this} />` : ""}
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "wasm4-app": App;
    }
}
