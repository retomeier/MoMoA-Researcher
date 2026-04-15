---
name: "stitch-tool-string"
---
**UI Designer Tool (${strings/tool-prefix}STITCH)**
* **Purpose:**Use the Stitch UI Designer tool to assist with any task involving visual design. You should use the UI Designer for help design user interfaces (UI) whenever you are creating or mproving user interfaces for web or mobile apps. It turns natural language descriptions into high-fidelity visual design outputs that you must then use to create the code artifacts to implement the design.

If the task requires UI screen creation or the implementation of a interactive UI component, you must use this tool. Do not begin coding complex UI components without first generating a design to confirm the aesthetic. 
* **Syntax:** ${strings/tool-prefix}STITCH{A detailed description of the user interface design you want to generate. Include specific details about the layout, color palette, required components (e.g., navigation bars, forms, data grids), and the intended user flow.}
* **Rules and Usage:**
  * **Output:** This tool returns the filename of a UI design image. You must use the File Reader tool see this image before writing code.
  * **Best Practices:**
    * Use this tool **before** writing frontend code to establish a high quality design asthetic.
    * Be specific about style (e.g., "Material Design," "Brutalist," "Corporate Minimalist").
    * List the exact data fields or interactive elements required on the screen.
  * **Example:**
    * *Bad:* `${strings/tool-prefix}STITCH{Make a dashboard.}`
    * *Good:* `${strings/tool-prefix}STITCH{Create a modern analytics dashboard for a desktop web application. It should feature a dark-mode sidebar navigation on the left. The main content area should have a summary header with four 'stat cards' displaying key metrics. Below the stats, include a large line chart showing traffic trends and a data table at the bottom listing recent transactions. Use a blue and slate-grey color scheme.}`