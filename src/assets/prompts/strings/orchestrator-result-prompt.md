---
name: "orchestrator-result-prompt"
---
Now that you're finished solving the project assigned to you, it's time to create a structured final output. Review the last response you just returned carefully, as well as considering the work that was done to generate it. Think VERY carefully about the initial project request and any specific guidance it included in terms of format or structure. If you were asked to provide something, make sure that's what you provide here.

You MUST now return the final result as plain text, using only limited markdown. This is the final result that represents the delivery of the solution to the original project definition. Take particular notice of the content after '${strings/tool-prefix}RESULT' in your last response and make sure that's captured here, but you MUST NEVER include the tool phrase '${strings/tool-prefix}RESULT' itself in your response. The solution will likely involve files that have been edited or created, in which case you must reference them here by name, but you MUST NOT include the contents of any files in your response.

For reference, the following files were created or edited during this project:
${EditedFiles}