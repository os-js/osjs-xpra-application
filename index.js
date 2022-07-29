/*
 * OS.js - JavaScript Cloud/Web Desktop Platform
 *
 * Copyright (c) Anders Evenrud <andersevenrud@gmail.com>
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

import osjs from 'osjs';
import {h, app} from 'hyperapp';
import {name as applicationName} from './metadata.json';
import {createClient} from 'xpra-html5-client';
import {Box, BoxContainer, ToggleField, TextField} from '@osjs/gui';

const register = (core, args, options, metadata) => {
  let tray;
  let status = 'disconnected';
  let windows = [];
  const proc = core.make('osjs/application', {args, options, metadata});
  const defaultOptions = {
    uri: proc.settings.uri || 'ws://localhost:10000',
    sound: proc.settings.sound || false,
    username: proc.settings.username || 'username',
    password: proc.settings.password || 'password',
    passwords: [ proc.settings.password ],
    autologin: proc.settings.autologin || false,
    bandwidth_limit: 0
  };

  const withWindow = (id, cb) => {
    const found = windows.find(w => w.id === 'XpraWindow_' + id);
    if (found) {
      cb(found);
    }
  };

  const createConnectionDialog = (cb) => {
    const view = ($content, dialogWindow, window) => {
      window._app = app(defaultOptions, {
        setState: ({key, value}) => state => ({[key]: value}),
        getState: () => state => state,
      }, (state, actions) => {
        return window.createView([
          h(Box, {grow: 1}, [
            h(BoxContainer, {}, 'URI'),
            h(TextField, {
              value: state.uri,
              oninput: (ev, value) => {
                actions.setState({key: 'uri', value});
                proc.setting.uri = value;
                proc.saveSettings();
              }
            }),
            h(BoxContainer, {}, 'Username'),
            h(TextField, {
              value: state.username,
              oninput: (ev, value) => {
                actions.setState({key: 'username', value});
                proc.settings.username = value;
                proc.saveSettings();
              }
            }),
            h(BoxContainer, {}, 'Password'),
            h(TextField, {
              value: state.password,
              type: 'password',
              oninput: (ev, value) => {
                actions.setState({key: 'password', value});
                proc.settings.password = value;
                proc.saveSettings();
              }
            }),
            h(BoxContainer, {}, 'Enable Sound (experimental) ?'),
            h(ToggleField, {
              checked: state.sound,
              onchange: (ev, value) => {
                actions.setState({key: 'sound', value});
                proc.settings.sound = value;
                proc.saveSettings();
              }
            }),
            h(BoxContainer, {}, 'Enable Autologin'),
            h(ToggleField, {
              checked: state.autologin,
              onchange: (ev, value) => {
                actions.setState({key: 'autologin', value});
                proc.settings.autologin = value;
                proc.settingSave();
              }
            })
          ])
        ]);
      }, $content);
    };

    core.make('osjs/dialogs')
      .create({
        buttons: ['cancel', 'ok'],
        window: {
          title: 'Xpra Connection',
          dimension: {width: 300, height: 420}
        }
      }, dialog => {
        return dialog._app.getState();
      }, (button, value) => {
        if (button === 'ok') {
          cb(value);
        }
      })
      .render(view);
  };


  const client = createClient(defaultOptions, {
    worker: proc.resource('worker.js')
  });

  if (core.has('osjs/tray')) {
    tray = core.make('osjs/tray').create({
      icon: proc.resource('logo.png')
    }, (ev) => {
      const c = status === 'connected';

      core.make('osjs/contextmenu').show({
        position: ev,
        menu: [{
          label: c ? 'Disconnect' : 'Connect',
          onclick: () => c
            ? client.disconnect()
            : client.connect(defaultOptions)
        }, {
          label: 'Settings',
          onclick: () =>
            createConnectionDialog(options => {
              proc.settings = options;
              proc.saveSettings();
              Object.assign(defaultOptions, options);
            })
        }, {
          label: 'Windows',
          menu: []
        }]
      });
    });

    if(proc.settings.autologin === true)  {
      defaultOptions.reconnect = true;
      client.connect(defaultOptions);
    }

    proc.on('destroy', () => tray.destroy());
  }

  client.on('window:create', w => {
    console.warn(w);

    const win = core.make('osjs/window', {
      id: 'XpraWindow_' + w.wid,
      title: w.metadata.title,
      dimension: {
        width: w.w,
        height: w.h
      },
      position: {
        top: w.y,
        left: w.x
      }
    });

    win.on('close', () => client.surface.kill(w.wid));
    win.on('focus', () => client.surface.focus(w.wid));
    win.on('keydown, keypress, keyup', ev => client.inject(ev));
    win.on('render', () => {
      win.setDimension({
        width: w.w,
        height: w.h + win.$header.offsetHeight
      });
    });

    win.init();

    win.render($content => {
      win._metadata = w.metadata;
      win._app = app({
        overlays: []
      }, {
        addOverlay: overlay => state => {
          return {overlays: [...state.overlays, overlay]};
        },
        removeOverlay: ({wid}) => state => {
          const overlays = state.overlays;
          const foundIndex = overlays.findIndex(o => o.wid === wid);
          if (foundIndex !== -1) {
            overlays.splice(foundIndex, 1);
          }

          return {overlays};
        }
      }, (state, actions) => {
        return h('div', {
          class: 'xpra--root',
          onmousemove: ev => client.inject(ev),
          onmousedown: ev => client.inject(ev),
          onmouseup: ev => client.inject(ev),
          style: {
            position: 'relative'
          }
        }, [
          h('div', {
            position: 'absolute',
            zIndex: 1,
            oncreate: el => el.appendChild(w.canvas)
          }),
          ...state.overlays.map(s => h('div', {
            key: s.wid,
            class: 'xpra--surface',
            style: {
              position: 'absolute',
              zIndex: 10,
              top: `${s.y - w.y}px`,
              left: `${s.x - w.x}px`
            },
            oncreate: el => el.appendChild(s.canvas)
          }))
        ]);
      }, $content);
    });

    windows.push(win);
  });

  client.on('window:destroy', ({wid}) => {
    const foundIndex = windows.findIndex(w => w.id === 'XpraWindow_' + wid);
    if (foundIndex !== -1) {
      windows[foundIndex].destroy();
      windows.splice(foundIndex, 1);
    }
  });

  client.on('window:icon', ({wid, src}) => {
    withWindow(wid, win => win.setIcon(src));
  });

  client.on('window:metadata', ({wid, metadata}) => {
    withWindow(wid, win => {
      const newMetadata = Object.assign({}, win._metadata, metadata);
      win.setTitle(newMetadata.title);
    });
  });

  client.on('overlay:create', o => {
    console.warn(o);
    withWindow(o.parent.wid, win => {
      win._app.addOverlay(o);
    });
  });

  client.on('overlay:destroy', o => {
    withWindow(o.parent.wid, win => {
      win._app.removeOverlay(o);
    });
  });

  client.on('ws:status', s => (status = s));

  client.on('ws:close', () => {
    core.make('osjs/notification', {
      title: 'Xpra',
      message: 'Connection was closed',
      icon: proc.resource('logo.png')
    });
  });

  client.on('system:started', () => {
    core.make('osjs/notification', {
      title: 'Xpra',
      message: 'Session running',
      icon: proc.resource('logo.png')
    });
  });

  client.on('notification:create', (id, options) => {
    core.make('osjs/notification', {
      title: options.summary,
      message: options.body,
      icon: options.icon
    });
  });

  proc.on('destroy', () => {
    if (tray) {
      tray.destroy();
    }
  });

  return proc;
};

osjs.register(applicationName, register);
