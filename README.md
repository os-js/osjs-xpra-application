<p align="center">
  <img alt="OS.js Logo" src="https://raw.githubusercontent.com/os-js/gfx/master/logo-big.png" />
</p>

[OS.js](https://www.os-js.org/) is an [open-source](https://raw.githubusercontent.com/os-js/OS.js/master/LICENSE) desktop implementation for your browser with a fully-fledged window manager, Application APIs, GUI toolkits and filesystem abstraction.

[![Community](https://img.shields.io/badge/join-community-green.svg)](https://community.os-js.org/)
[![Donate](https://img.shields.io/badge/liberapay-donate-yellowgreen.svg)](https://liberapay.com/os-js/)
[![Donate](https://img.shields.io/badge/paypal-donate-yellow.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=andersevenrud%40gmail%2ecom&lc=NO&currency_code=USD&bn=PP%2dDonationsBF%3abtn_donate_SM%2egif%3aNonHosted)
[![Support](https://img.shields.io/badge/patreon-support-orange.svg)](https://www.patreon.com/user?u=2978551&ty=h&u=2978551)

# OS.js v3 Xpra Package

This is the Xpra Package for OS.js v3

**This repository uses Git submodules**

## Usage

You'll need:

* Xpra installed
* Websockify (**with the python module**)
* python-dbus, python-gobject

At the moment you'll have to manually start a process, for example Firefox:

```
xpra --no-daemon --bind-tcp=127.0.0.1:10000 --start=firefox --html=on start :2
```

Then connect via the provided tray icon.

**PLEASE NOTE THAT THIS IS AN ALPHA PRE-RELEASE AND SUBJECT TO CHANGE WITHOUT NOTICE**
