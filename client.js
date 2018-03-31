/*
 * OS.js - JavaScript Cloud/Web Desktop Platform
 *
 * Copyright (c) 2011-2018, Anders Evenrud <andersevenrud@gmail.com>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * @author  Anders Evenrud <andersevenrud@gmail.com>
 * @licence Simplified BSD License
 */

//
// This is a re-implementation of certain Xpra HTML5 client features
// All code belongs to its respective copyright holders.
//

const {XpraClient} = window;

/*
 * Overrides for default Client
 */
class MyXpraClient extends XpraClient {

  constructor(proc, tmp, bus) {
    super(tmp, {
      workerPath: proc.resource('js/lib/wsworker_check.js'),
      protocolPath: proc.resource('js/Protocol.js')
    });

    this.__bus = bus;
    this.__proc = proc;
  }

  on_open() {
    this.__bus.emit('open');
  }

  on_connect() {
    this.__bus.emit('connect');
  }

  callback_close() {
    this.__bus.emit('close');
  }

  _set_favicon() {
    // noop
  }

  _new_window(wid, x, y, w, h, metadata, override_redirect, client_properties) {
    this.__bus.emit('new-window', {wid, x, y, w, h, metadata, override_redirect, client_properties}, (win) => {
      this.id_to_window[wid] = win;

      if (!override_redirect) {
        this.send(['map-window', wid, x, y, w, h, client_properties]);
      }
    });
  }
}

/*
* Reads image from raw data
 */
const readImage = (ab, type) => new Promise((resolve, reject) => {
  const b = new Blob([ab], {type: `image/${type}`});
  const r = new FileReader();
  r.onerror = e => reject(e);
  r.onloadend = () => resolve(r.result);
  r.readAsDataURL(b);
});

/*
 * Decompress Zlip stream
 */
const decompressZlib = (data) => new Zlib.Inflate(data).decompress();

/*
 * Decompress Lz4 stream
 */
const decompressLz4 = (data) => {
  const d = data.subarray ? data.subarray(0, 4) : data.slice(0, 4);
  const length = d[0] | (d[1] << 8) | (d[2] << 16) | (d[3] << 24);
  const inflated = new Buffer(length);
  const size = data.subarray
    ? LZ4.decodeBlock(data.subarray(4), inflated)
    : LZ4.decodeBlock(data.slice(4), inflated);

  return inflated.slice(0, size);
}

/*
 * Paints a canvas with given frame
 */
const renderFrame = (canvas, ctx, item, cb) => {
  const [x, y, width, height, coding, img_data, packet_sequence, rowstride, options, decode_callback] = item;
  const encWidth = options.scaled_size ? options.scaled_size[0] : width;
  const encHeight = options.scaled_size ? options.scaled_size[1] : height;

  try {
    if (coding === 'rgb32') {
      const img = ctx.createImageData(width, height);
      const decoded = options && options['zlib']
        ? decompressZlib(img_data)
        : (options && options['lz4'] ? decompressLz4(img_data) : img_data);

      if(decoded.length > img.data.length) {
        console.warn('Length mismatch!');
      } else {
        img.data.set(decoded);
        ctx.putImageData(img, x, y);
      }
    } else if (coding === 'jpeg' || coding === 'png') {
      const img = ctx.createImageData(width, height);
      const tmp = new Image();
      tmp.onload = () => {
        if (tmp.width <= 0 || tmp.height <= 0) {
          console.warn('Skipped frame', 'no dimensions');
        } else {
          ctx.drawImage(tmp, x, y);
        }

        cb(decode_callback);
      };

      readImage(img_data, coding)
        .then(src => (tmp.src = src))
        .catch(err => console.warn('Skipped frame', err));

      return;
    } else if (coding === 'h264') {
      // TODO
      console.error('h264 encoding not yet supported');
    } else if (['h264+mp4', 'vp8+webm', 'mpeg4+mp4'].indexOf(coding) !== -1) {
      // TODO
      console.error('mp4 encoding not yet supported');
    } else if (coding === 'scroll') {
      for(let i = 0, j = img_data.length; i < j; ++i) {
        const [sx, sy, sw, sh, xdelta, ydelta] = img_data[i];
        ctx.drawImage(canvas, sx, sy, sw, sh, sx + xdelta, sy + ydelta, sw, sh);
      }
    }
  } catch (e) {
    console.error(e);
  }

  cb(decode_callback);
};

/*
 * Gets mouse event data
 */
const getMouseEvent = (ev, rect, props) => {
  const x = parseInt(ev.clientX - rect.x, 10) + props.x;
  const y = parseInt(ev.clientY - rect.y, 10) + props.y;
  const button = 'which' in ev
    ? Math.max(0, ev.which)
    : Math.max(0, ev.button) + 1;

  return {x, y, button};
};

/*
 * Creates a new rendering surface
 */
const createSurface = (client, win, props, isOverlay) => {
  let rect = {x: 0, y: 0};
  let {x, y} = props;

  const buffer = document.createElement('canvas');
  buffer.width = props.w;
  buffer.height = props.h;

  const canvas = document.createElement('canvas');
  canvas.width = props.w;
  canvas.height = props.h;

  const canvasCtx = canvas.getContext('2d');
  const bufferCtx = buffer.getContext('2d');

  let paint_pending = 0;
  let paint_queue = [];

  const paint = () => {
    let now = performance.now() * 1000;
    while ((paint_pending === 0 || (now - paint_pending) >= 2000) && paint_queue.length > 0) {
      paint_pending = now;

      renderFrame(buffer, bufferCtx, paint_queue.shift(), (decode_callback) => {
        paint_pending = 0;
        decode_callback(client);
        paint();
      });

      now = performance.now() * 1000
    }
  };

  const resize = (offsetWidth, offsetHeight, ref) => {
    canvas.width = offsetWidth;
    canvas.height = offsetHeight;
    buffer.width = offsetWidth;
    buffer.height = offsetHeight;

    client._window_geometry_changed(ref);

    paint();
  };

  const move = () => {
    rect = canvas.getBoundingClientRect();
  };

  const surface = Object.assign({
    initiate_moveresize: () => false, // TODO
    update_zindex: () => false, // TODO
    updateFocus: () => false, // TODO

    client,
    destroy: () => {
      canvas.remove();
    },
    move_resize: (...args) => {
      const [offsetWidth, offsetHeight, offsetLeft, offsetTop] = args;
      x = offsetLeft;
      y = offsetTop;

      resize(offsetWidth, offsetHeight, surface);
    },
    update_metadata: (metadata) => {
      if (!isOverlay) {
        if ('title' in metadata) {
          win.setTitle(metadata.title);
        }
      }
    },
    reset_cursor: () => {
      canvas.style.cursor = 'default';
    },
    set_cursor: (encoding, w, h, xhot, yhot, img_data) =>  {
      if (encoding === 'png') {
        readImage(img_data, encoding).then(uri => canvas.style.cursor = `url(${uri})`);
      }
    },
    set_spinner: (s) => {
      if (!isOverlay) {
        win.setState('loading', !s);
      }
    },
    update_icon: (width, height, encoding, img_data) => {
      if (!isOverlay && encoding === 'png') {
        readImage(img_data, encoding).then(uri => win.setIcon(uri));
      }
    },
    get_internal_geometry: () => {
      return isOverlay ? {
        x,
        y,
        w: props.w,
        h: props.h
      } : {
        x,
        y,
        w: win.$content.offsetWidth,
        h: win.$content.offsetHeight
      };
    },
    paint: (...items) => {
      paint_queue.push(items);
      paint();
    },
    draw: () => {
      canvasCtx.drawImage(buffer, 0, 0);
    }
  }, props);

  canvas.addEventListener('mousemove', ev => {
    const {x, y} = getMouseEvent(ev, rect, props);
    client._window_mouse_move(surface, x, y, [], []);
  });

  canvas.addEventListener('mousedown', ev => {
    const rect = canvas.getBoundingClientRect();
    const {x, y, button} = getMouseEvent(ev, rect, props);
    client._window_mouse_click(surface, button, true, x, y, [], []);
  });

  canvas.addEventListener('mouseup', ev => {
    const {x, y, button} = getMouseEvent(ev, rect, props);
    client._window_mouse_click(surface, button, false, x, y, [], []);
  });

  canvas.addEventListener('mousewheel', ev => {
    const {x, y} = getMouseEvent(ev, rect, props);
    const btn_x = (ev.deltaX >= 0) ? 6 : 7;
    const btn_y = (ev.deltaY >= 0) ? 5 : 4;

    client._window_mouse_click(surface, btn_x, true, x, y, [], []);
    client._window_mouse_click(surface, btn_x, false, x, y, [], []);

    client._window_mouse_click(surface, btn_y, true, x, y, [], []);
    client._window_mouse_click(surface, btn_y, false, x, y, [], []);
  });

  return {surface, buffer, canvas, resize, move};
}

/*
 * Creates a new Xpra connection
 */
const createConnection = (client, options) => {
  Object.keys(options).forEach(k => client[k] = options[k]);
  client.init([]);
  client.connect();
}

export {
  draw,
  readImage,
  createSurface,
  createConnection,
  MyXpraClient as XpraClient
};
