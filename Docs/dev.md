1. Create a mock endpoint that simply fetches any information from notion

2. Create a mock endpoint that simply returns the content of the page 'Movies (orthodox)'. The endpoint needs to find the location of that page.

3. Create a mock endpoint that simply returns the content of every page. Basically concatenate the content of every page, in that notion, and return it.

4. Create a new endpoint by refactoring the previous one to filter the lines, still search in all pages, but filter the lines to the ones that have the string. 'this_month this_year' or 'previous_month this_year' or 'previous_previous_month this_year'. For example if we are in January 2027, then it should search for 'January 2027', 'December 2026', 'November 2026'.

IMPORTANT: ONLY TRAVERSE THROUGH LEAF NODES, NO PARENT NODES. Maybe traverse through parent nodes only to find the leaf nodes.


The answer format response should be like this:

{
    "June 2026" : [
        {
            "Indie Albums (orthodox)" : [
                "37 - Keep It Like a Secret - Built to Spill [June 2026 - S\u00e3o Roque]"
            ]
        }
    ],

    "July 2026" : [
        {
            "Indie Albums (orthodox)" : [
                "148 - Boxer - The National [July 2026 - Caruaru]"
            ]
        }
    ]

}

5. This server should not only be an API. It should also be a UI, it should be a web app. It should return whatever what is in this endpoint: 'api/month-lines'