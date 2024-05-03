import { throttle } from 'lodash-es';
import { createUpdateCompletedEvent } from './events/update-completed';
import { closeDevtoolsEventType } from './events/close-devtools';
import { wasm4DevtoolsTagName } from './components/devtools/devtools';
import * as constants from './constants';

interface BufferedData {
  mouseButtons: number;
  gamepads: number[];
}

class BufferedRuntimeData implements BufferedData {
  mouseButtons = 0;
  gamepads = [0, 0, 0, 0];

  update = (dataView: DataView): void => {
    this.mouseButtons =
      this.mouseButtons | dataView.getUint8(constants.ADDR_MOUSE_BUTTONS);

    for (let i = 0, len = this.gamepads.length; i < len; i++) {
      this.gamepads[i] =
        dataView.getUint8(
          (constants as Record<string, any>)[`ADDR_GAMEPAD${i + 1}`]
        ) | this.gamepads[i];
    }
  };

  /**
   * Returns buffered that and resets current state.
   * @returns
   */
  flush = (): BufferedData => {
    const output = {
      mouseButtons: this.mouseButtons,
      gamepads: this.gamepads.slice(),
    };

    this.mouseButtons = 0;
    this.gamepads.fill(0);

    return output;
  };
}

interface RuntimeInfo {
  data: DataView;
  wasmBufferByteLen: number;
}

export class DevtoolsManager {
  /**
   * @private
   */
  private _enabled = false;

  /**
   * @private
   */
  private _bufferedData = new BufferedRuntimeData();

  private _deltaBuffer : number[] = [0,0,0,0,0,0,0,0,0,0];
  private _deltaBufferIdx = 0;
  //calculate an average FPS for the last 10 frames
  private _calcAvgFPS = () => {
    return Math.round(1_000 / (this._deltaBuffer.reduce((acc, fps) => acc + fps, 0) / this._deltaBuffer.length));
  }
  private _nextFPSBufferIdx = () => {
    this._deltaBufferIdx = (this._deltaBufferIdx + 1) % this._deltaBuffer.length;
    return this._deltaBufferIdx;
  }

  /**
   * Notifies the devtools that the web runtime has completed an update.
   */
  updateCompleted = <Info extends RuntimeInfo>(
    runtimeInfo: Info,
    deltaFrame: number
  ) => {
    if (this._enabled) {
      this._deltaBuffer[this._nextFPSBufferIdx()] = deltaFrame;
      this._bufferedData.update(runtimeInfo.data);
      this._notifyUpdateCompleted(
        runtimeInfo.data,
        runtimeInfo.wasmBufferByteLen,
        this._calcAvgFPS()
      );
    }
  };

  removeDevTools = () => {
    if (this._enabled) {
      this.toggleDevtools();
    }
  };

  toggleDevtools = () => {
    this._enabled = !this._enabled;

    if (this._enabled) {
      window.addEventListener(closeDevtoolsEventType, this.removeDevTools);
      document.body.appendChild(document.createElement(wasm4DevtoolsTagName));
    } else {
      window.removeEventListener(closeDevtoolsEventType, this.removeDevTools);
      Array.from(document.body.querySelectorAll(wasm4DevtoolsTagName)).forEach(
        (elem) => {
          elem?.parentElement?.removeChild(elem);
        }
      );
    }
  };

  private _notifyUpdateCompleted = throttle(
    (dataView: DataView, wasmBufferByteLen: number, fps: number) => {
      window.dispatchEvent(
        createUpdateCompletedEvent({
          dataView,
          wasmBufferByteLen,
          fps,
          bufferedData: this._bufferedData.flush(),
        })
      );
    },
    200
  );
}
