/*!
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
import {
  XpraClient,
  createSurface,
  createConnection,
  readImage,
  draw
} from './client.js';

/*
 * Parse given WebSocket connection URI
 */
const parseConnectionUri = value => {
  const a = document.createElement('a');
  a.href = value;
  const {hostname, port, protocol} = a;
  return {hostname, port, ssl: protocol.match(/((http|ws)s:)$/)};
};

/*
 * Window factory
 */
const createWindowFactory = (core, proc, client) => (props) => {
  console.warn('Creating new Xpra Window', props);

  const win = proc.createWindow({
    id: 'XpraWindow_' + props.wid,
    icon: proc.resource(proc.metadata.icon),
    title: props.metadata.title,
    attributes: {
      modal: props.metadata.modal === 1
    },
    state: {
      maximized: props.metadata.maximized === 1,
      minimized: props.metadata.minimized === 1,
    },
    dimension: {
      width: props.w,
      height: props.h
    },
    position: {
      left: props.x,
      top: props.y
    }
  });

  const {surface, buffer, canvas, resize, move} = createSurface(client, win, props);
  canvas.style.position = 'relative';
  canvas.style.zIndex = 1;

  win._surface = surface;

  win.on('focus', () => client._window_set_focus(surface));
  win.on('close', () => {
    // FIXME
    if (confirm('Close window in X session?')) {
      client._window_closed(surface);
    }
  });
  win.on('resized, maximize, restore', () => {
    setTimeout(() => {
      const {offsetWidth, offsetHeight} = win.$content;
      resize(offsetWidth, offsetHeight, surface);
    }, 1);
  });
  win.on('moved', () => move());
  win.on('render', () => move());

  win.render($content => {
    //$content.style.overflow = 'visible';
    $content.appendChild(canvas);
    win.resizeFit(canvas);
  });

  return surface;
};

/*
 * Overlay factory
 */
const createOverlayFactory = (core, proc, client) => (parent, props) => {
  console.warn('Creating new Xpra Overlay', props);

  const geom = parent._surface.get_internal_geometry();
  const {surface, canvas} = createSurface(client, {}, props, true);
  canvas.style.position = 'absolute';
  canvas.style.top = String(props.y - geom.y) + 'px';
  canvas.style.left = String(props.x - geom.x) + 'px';
  canvas.style.zIndex = 10;
  canvas.style.pointerEvents = 'none';

  parent.$content.appendChild(canvas);

  return surface;
};

/*
 * Notification factory
 */
const createNotificationFactory = (core, proc) => message => {
  core.make('osjs/notification', {
    icon: proc.resource('/icon.png'),
    title: 'Xpra',
    message
  });
};

/*
 * Connection dialog
 */
const createConnectionDialog = (core, proc, client) => {
  core.make('osjs/dialog', 'prompt', {
    title: 'Xpra Connection Dialog',
    message: 'Enter the server address for connection:',
    value: 'ws://localhost:10000'
  }, (btn, value) => {
    if (btn === 'ok') {
      const uri = parseConnectionUri(value);
      const options = {
        debug: true,
        keyboard_layout: 'no',
        ssl: uri.ssl,
        host: uri.hostname,
        port: uri.port,
        username: '',
        password: '',
      };

      console.warn(uri, options);

      proc.args.lastConnection = options;

      createConnection(client, options);
    }
  });
};

/*
 * Tray Menu
 */
const createTrayMenuFactory = (core, proc, client) => () => ([
  {
    label: 'New connection',
    onclick: () => createConnectionDialog(core, proc, client)
  },
  {
    label: 'Windows', items: proc.windows.map(w => ({
      label: w.state.title,
      onclick: () => w.focus()
    }))
  },
  {
    label: 'Quit',
    onclick: () =>  proc.destroy()
  }
]);

/*
 * OS.js Application
 */
OSjs.make('osjs/packages').register('Xpra', (core, args, options, metadata) => {
  const tmp = document.createElement('div');
  tmp.style.display = 'none';
  core.$root.appendChild(tmp);

  const bus = core.make('osjs/event-handler', 'XpraBus');
  const proc = core.make('osjs/application', {args, options, metadata});
  const client = new XpraClient(proc, tmp, bus);
  const notifications = createNotificationFactory(core, proc);
  const window = createWindowFactory(core, proc, client);
  const overlay = createOverlayFactory(core, proc, client);
  const menu = createTrayMenuFactory(core, proc, client);

  // Client events
  bus.on('new-window', (props, cb) => {
    if (props.override_redirect) {
      const id = `XpraWindow_${props.metadata['override-redirect']}`
      const found = proc.windows.find(w => w.id === id);
      if (found) {
        cb(overlay(found, props));
      } else {
        console.warn('Failed to find parent window', id);
      }
    } else {
      cb(window(props));
    }
  });
  bus.on('connect', () => notifications('Connecting...'));
  bus.on('close', () => {
    notifications('Disconnected.');
    proc.removeWindow(() => true);
  });

  // Tray icon
  if (core.has('osjs/tray')) {
    const tray = core.make('osjs/tray').create({
      icon: proc.resource(metadata.icon)
    }, (ev) => {
      core.make('osjs/contextmenu').show({
        position: ev,
        menu: menu()
      });
    });

    proc.on('destroy', () => tray.destroy());
  }

  // Cleanups
  proc.on('destroy', () => tmp.remove());

  // Restoration
  if (proc.args.lastConnection) {
    createConnection(client, proc.args.lastConnection);
  }

  return proc;
});
