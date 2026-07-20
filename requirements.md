## Requirements for an UI

Display nicely the result of this: api/month-lines

## Requirements for an API endpoint api/month-lines

* Read all Notion pages in the workspace associated with `davisena1945@gmail.com`.
* Search the entire workspace in real time, or with sufficiently low latency.
* Dynamically determine:

  * `current_month_year`
  * `previous_month_year`
* Return every line containing either `current_month_year` or `previous_month_year`.

Example:

```text
Execution date: July 2026

current_month_year  = July 2026
previous_month_year = June 2026

Return every line containing:
- "July 2026"
- "June 2026"
```
