// AudioWorklet processor for the SPU output.
//
// `processor` never runs on the main thread: its source text is turned into
// a data: URL and passed to audioWorklet.addModule(), where it runs in
// AudioWorkletGlobalScope (no window or document, only AudioWorkletProcessor,
// registerProcessor and sampleRate). It must not reference anything outside
// itself. A data: URL also loads when the page is opened from file://, where
// fetching a separate worklet file or a blob: URL is refused.
mdlr('enge:psx:spu-worklet', () => {

  const processor = () => {

    class EngeSpuOutput extends AudioWorkletProcessor {
      constructor(options) {
        super();
        const inputRate = options.processorOptions.inputRate;
        this.step = inputRate / sampleRate;
        this.prebuffer = (inputRate * 0.05) | 0;          // start after 50 ms queued
        this.maxQueued = (inputRate * 0.20) | 0;          // drop beyond 200 ms
        this.reset();
        this.port.onmessage = ({ data }) => {
          if (data.clear) {
            this.reset();
            return;
          }
          this.queue.push(data);
          this.queued += data.left.length;
          while (this.queued > this.maxQueued && this.queue.length > 1) {
            const dropped = this.queue.shift();
            this.queued -= dropped.left.length - this.offset;
            this.offset = 0;
          }
        };
      }

      reset() {
        this.queue = [];
        this.offset = 0;
        this.queued = 0;
        this.playing = false;
        this.frac = 0;
        this.curL = this.curR = 0;
        this.nextL = this.nextR = 0;
      }

      pull() {
        const chunk = this.queue[0];
        this.nextL = chunk.left[this.offset];
        this.nextR = chunk.right[this.offset];
        if (++this.offset === chunk.left.length) {
          this.queue.shift();
          this.offset = 0;
        }
        --this.queued;
      }

      process(inputs, outputs) {
        const out = outputs[0];
        const outL = out[0];
        const outR = out[1] || out[0];
        const frames = outL.length;

        if (!this.playing) {
          if (this.queued < this.prebuffer) return true;  // outputs are zeroed
          this.playing = true;
          this.frac = 0;
          this.pull();
          this.curL = this.nextL; this.curR = this.nextR;
          this.pull();
        }

        for (let i = 0; i < frames; ++i) {
          const f = this.frac;
          outL[i] = this.curL + (this.nextL - this.curL) * f;
          outR[i] = this.curR + (this.nextR - this.curR) * f;
          this.frac += this.step;
          while (this.frac >= 1.0) {
            this.frac -= 1.0;
            this.curL = this.nextL; this.curR = this.nextR;
            if (this.queued === 0) {
              // underrun: go quiet and wait for the prebuffer to fill again
              this.reset();
              return true;
            }
            this.pull();
          }
        }
        return true;
      }
    }

    registerProcessor('enge-spu-output', EngeSpuOutput);

  };

  const name = 'enge-spu-output';
  const url = () => 'data:application/javascript;charset=utf-8,' + encodeURIComponent(`(${processor})();`);

  return { name, url };

});
