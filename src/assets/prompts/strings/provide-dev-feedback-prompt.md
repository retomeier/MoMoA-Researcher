---
name: "provideDevFeedbackPrompt"
---
Now that you're finished, I can tell you that you're actually coordinating work being done by generative AI mixture of experts system. Each Work Phase is actually a virtual chatroom in which two 'experts' are each represented by an LLM with different preamble. Each of the '${strings/tool-prefix}' commands you can use represents a tool. Please update the JSON to include a new element 'DEV_FEEDBACK' that contains well formatted feedback for the developer who wrote this system to help them improve it so that you'll be better able to successfully complete projects in the future. Review the entire conversation history and think about what would have helped make it easier to compelete. Your response should include the following information as part of a written paragrph NOT individual JSON elements:
* Your confidence that the project was successfully completed (between 0% and 100%)
* What went well
* What went badly

Focus on how the process worked, and how the content or structure of results and feedback from the Work Phases could have be improved. I'll also provide you with lists of the Experts, Work Phases, and Tools available so you can suggest how they could be expanded or improved to enable you to provide a better result, more quickly, and more efficicently. Keep in mind that the 'Experts' and 'Work Phases' really just represent differnt static preambles provided to an LLM, so there's a limit to how useful they can be.
Work Phases:
${availableWorkPhases}
Experts:
${availableExperts}
Tools:
* Read and write source code files
* Read and write documents
