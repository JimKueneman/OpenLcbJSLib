# DO NOT EDIT FILES IN THIS DIRECTORY

This directory is a **synced copy** of `OpenLcbCLib/tools/node_wizard/`.

Source of truth lives in the OpenLcbCLib repo at `tools/node_wizard/`.

Any edits made here will be **overwritten** on the next sync.  To change the
wizard:

1. Edit the files in OpenLcbCLib's `tools/node_wizard/`
2. From this repo's root, run:
   `./tools/wasm_update_wizard/wasm_update_wizard.sh`
3. The sync step copies the latest version here

A runtime banner at the top of `node_wizard.html` makes the same warning
visible when the wizard is opened in a browser.
