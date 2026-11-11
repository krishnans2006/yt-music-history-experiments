# YT Music History Experiments

Scripts/methodology to get the best possible export of YouTube Music listen history, in the best possible format.

**Disclaimer:** A large portion of this project is AI-generated or AI-assisted. But it works.

## Current leading method

**A script running in the browser console on the YouTube History page (My Activity)**. This is the only method that seems to reliably capture the full history, including repeat-one listens. It does so by spamming an internal Google API endpoint with specially crafted requests, and then parsing the responses to extract the relevant data. See [the AI-generated documentation](./myactivity-browser/myactivity-fast.md) for more details.

**TL;DR:** Run [this script](./myactivity-browser/myactivity-fast.js) within the console on [this page](https://myactivity.google.com/product/youtube). Adjust the start and end timestamps, then hit "Export/Resume". Wait for the script to finish, and it will automatically download a JSON file containing your full YouTube Music listen history.
