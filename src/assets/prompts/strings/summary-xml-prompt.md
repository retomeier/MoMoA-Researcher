---
name: "summaryXMLPrompt"
---
Generate a final project summary in valid XML format based on the provided XML summary, and the following specific instructions.

The XML must have a root element named '<Summary>'.
It must contain the following child elements:
- <RESULT>: A summary of the project's outcome or main deliverable.
- <WORK_SUMMARY>: A retrospective summary of the work performed by the experts.
- <USER_FEEDBACK>: Feedback intended for the user about the project outcome.
- <DEV_FEEDBACK>: Feedback intended for the agent/tool developers about the process.
- <FILES>: A list of files that were produced or significantly modified. Each file should be represented by a <FILE> element containing a <FILE_NAME> element with the filename as its text content and a <DESCRIPTION> element with a brief description of the file's contents.
- <MODEL_USE>: A summary of how many times each LLM API/Model pair was invoked during the process.

Ensure the content within the <RESULT>, <WORK_SUMMARY>, <USER_FEEDBACK>, and <DEV_FEEDBACK> tags is plain text (avoiding internal XML tags unless properly escaped or in CDATA).
The <FILES> section should list all the files that were produced, based on the available files.

Here is the required structure for the <MODEL_USE> element. Include this  structure as a child of the <Summary> element, with appropriate line breaks and indentation to make it easy to read:
${messageCountsXml}

The final response from the orchestrator provided below:
${finalOrchestratorResult}

Generate the complete XML summary now, starting with the <Summary> tag.
