I need this code to run well in netfly.

First problem, sometimes when I deploy it to Netlify, because of the secrets it failes because the port might be a secret leakage
- Something like this: 8:45:54 PM: ❯ Scanning complete. 8 file(s) scanned. Secrets scanning found 1 instance(s) of secrets in build output or repo code.
8:45:54 PM: ​
8:45:54 PM: Secret env var "PORT"'s value detected:
8:45:54 PM:   found value at line 12 in server.js
8:45:54 PM: ​
8:45:54 PM: To prevent exposing secrets, the build will fail until these secret values are not found in build output or repo files.


Second problem sometimes I am getting a not found error when I deploy it to Netlify, as if maybe the build works but it doesn't show in the page

Third problem, I need to be able to run it locally.

Fourth problem,
{
  "errorType": "Error",
  "errorMessage": "Unsupported framework",
  "trace": [
    "Error: Unsupported framework",
    "    at getFramework (/var/task/node_modules/serverless-http/lib/framework/get-framework.js:78:9)",
    "    at module.exports (/var/task/node_modules/serverless-http/serverless-http.js:14:21)",
    "    at Object.<anonymous> (/var/task/netlify/functions/api.js:4:26)",
    "    at Module._compile (node:internal/modules/cjs/loader:1871:14)",
    "    at Object..js (node:internal/modules/cjs/loader:2002:10)",
    "    at Module.load (node:internal/modules/cjs/loader:1594:32)",
    "    at Module._load (node:internal/modules/cjs/loader:1396:12)",
    "    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)",
    "    at Module.require (node:internal/modules/cjs/loader:1617:12)",
    "    at require (node:internal/modules/helpers:153:16)"
  ]
}