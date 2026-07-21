```mermaid
sequenceDiagram
    participant Page as Notion embedded page
    participant API as Brahman View API
    participant Notion as Notion API
    participant Workspace as Your Notion workspace content

    Page->>API: HTTP request
    API->>Notion: Authenticated request
    Notion->>Workspace: Fetch workspace content
    Workspace-->>Notion: Workspace data
    Notion-->>API: API response
    API-->>Page: Processed results
```
