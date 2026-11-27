"use strict";

class Apps4KidsPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const frameSize =
      options &&
      options.processorOptions &&
      Number.isInteger(options.processorOptions.frameSize) &&
      options.processorOptions.frameSize > 0
        ? options.processorOptions.frameSize
        : 4096;
    this._frameSize = frameSize;
    this._buffer = new Float32Array(frameSize);
    this._offset = 0;
  }

  process(inputs) {
    const input = inputs && inputs[0] && inputs[0][0];
    if (!input || input.length === 0) {
      return true;
    }
    let idx = 0;
    while (idx < input.length) {
      const remaining = this._frameSize - this._offset;
      const toCopy = Math.min(remaining, input.length - idx);
      this._buffer.set(input.subarray(idx, idx + toCopy), this._offset);
      this._offset += toCopy;
      idx += toCopy;

      if (this._offset >= this._frameSize) {
        const frame = new Float32Array(this._buffer);
        this.port.postMessage(frame, [frame.buffer]);
        this._offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("apps4kids-pcm-capture", Apps4KidsPcmCaptureProcessor);
