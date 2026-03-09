---
name: "file-editing-tool-string"
---
**File Editing Tool (${strings/tool-prefix}DOC/EDIT)**
* **Purpose:** Create, save, or edit files (documents, source code, etc.).
* **Syntax:**
${strings/tool-prefix}DOC/EDIT{Filename. MUST include curly braces.}
TO${strings/underscore}REPLACE:{Exact original text to replace. Leave empty for new files or to overwrite the entire file. MUST include curly braces and quote exactly.}
NEW${strings/underscore}TEXT:{The new text or replacement text. MUST include curly braces.}
END${strings/underscore}EDIT
* **Action:** Performs a string replacement of the *first* instance of TO${strings/underscore}REPLACE text with NEW${strings/underscore}TEXT.
* **Rules and Usage:**
  * **Exact Syntax:** Follow the structure (keywords, braces {}, line breaks, END${strings/underscore}EDIT) precisely. Remember, each ${strings/tool-prefix}DOC/EDIT attempt, no matter how small, must be a complete and syntactically correct command, including all necessary curly braces {}, the TO${strings/underscore}REPLACE:{...}, NEW${strings/underscore}TEXT:{...} fields, and the END${strings/underscore}EDIT keyword on its own line.
  * **Uniqueness:** The TO${strings/underscore}REPLACE string must be unique within the file to ensure the correct text is modified. CRITICAL: Remember, TO${strings/underscore}REPLACE targets only the exact text specified. It does NOT automatically include subsequent lines (like bullet points under a heading) unless they are explicitly part of the unique TO${strings/underscore}REPLACE string. To replace or delete a multi-line section, all its lines must be included in TO${strings/underscore}REPLACE, ensuring that the entire block is unique.
  * **Cohesive Edits:** Always Prefer edits that affect a cohesive block of the file, such as a paragraph, logical section (a heading and the text within that section), or logical code block rather than individual words/lines or overwriting the whole files. Verify success after each edit before proceeding.
  * **Cohesive Scope & Context Preservation**:
    * Always use cohesive parts of the file as the TO${strings/underscore}REPLACE string. Aim for section, paragraphs, or logical code blocks.
    * When replacing individual words or parts of a line/paragraph, it is often best practice to specify the *entire original line or paragraph* in TO${strings/underscore}REPLACE.
    * Then, in NEW${strings/underscore}TEXT, provide the *modified version* of that entire line or paragraph, incorporating your changes alongside the unchanged parts.
    * **Crucially: Having unchanged text (context) appear in both TO${strings/underscore}REPLACE and NEW${strings/underscore}TEXT is perfectly normal and often required for correctly targeting and executing the edit. This is NOT an error.**
    * For example, replacing 'TO${strings/underscore}REPLACE:{Line 1\nLine 2\nLine 3}' with 'NEW${strings/underscore}TEXT:{Line 1\nLine 2 MODIFIED\nLine 3}' correctly modifies Line 2 while using Lines 1 and 3 as context.
  * **Respect Code Structure:** When editing code files, pay strict attention to indentation, code blocks (functions, classes, loops, conditionals), and syntax. Edits must not break the structural integrity or syntax of the code. Ensure new code is placed at the correct indentation level and *outside* of unrelated code blocks unless specifically intended.
  * **Appending to a File**: To add new content (like a new function, class, or report section) to the very end of a file, use the explicit APPEND command. This does not require you to match existing text.
    * Set `TO${strings/underscore}REPLACE:{APPEND}`
    * Set `NEW${strings/underscore}TEXT:{Your new text to add to the bottom of the file}`
  * **Creting or Overwriting a File**: Use with extreme caution. To create a new file, or replace an existing file, you must explicitly declare it (empty brackets will result in an error). If the file exists, this will delete the existing content and replace it with only the new text.
    * Set `TO${strings/underscore}REPLACE:{OVERWRITE_ENTIRE_FILE}`
    * Set `NEW${strings/underscore}TEXT:{The complete new file content}`
  * **Deleting Files**: You can delete a file by overwriting the whole file with a blank value. Always check if a file exists by reading it before deleting it. Do not delete files that don't exist.
    * Set `TO${strings/underscore}REPLACE:{OVERWRITE_ENTIRE_FILE}`
    * Set `NEW${strings/underscore}TEXT:{}`
  * **Inserting Text**: To insert text identify a unique one or two consecutive lines (or small block of text), TO${strings/underscore}REPLACE immediately *before* or *after* the desired insertion point. This is the **anchor**.
    * **Preferred Insertion Strategy:** Whenever feasible, **aim to choose an anchor that exists immediately *before* the location where the new text should be added.** This means you will be inserting the new text *after* the anchor.
    * Construct the NEW${strings/underscore}TEXT field by combining exactly two parts:
      1. The **original anchor text** (the exact text from TO${strings/underscore}REPLACE).
      2. The **new text** block you want to insert.
    *  **CRITICAL:** The original anchor text (from TO${strings/underscore}REPLACE) MUST appear precisely ONE TIME within the final NEW${strings/underscore}TEXT field. Do NOT include the anchor text multiple times.
    * The order of these two parts within NEW${strings/underscore}TEXT depends on the chosen anchor strategy:
      * **(Preferred) To Insert AFTER the Anchor:** This is used when your chosen TO${strings/underscore}REPLACE anchor immediately precedes the desired insertion location. Place the single instance of the anchor text first in NEW${strings/underscore}TEXT, followed by the new text. 
      * For example:
```
TO${strings/underscore}REPLACE:{Anchor Text Line 1
Anchor Text Line 2}
NEW${strings/underscore}TEXT:{Anchor Text Line 1
Anchor Text Line 2
Your New Text Here}
```
        * Will result in:
```
Anchor Text Line 1
Anchor Text Line 2
Your New Text Here
```
        * **(Alternative) Inserting BEFORE the Anchor:** This is used if the only practical unique anchor is immediately *after* the desired insertion location. Place the new text first in NEW${strings/underscore}TEXT, followed by the single instance of the anchor text.
          * For Example:
```
TO${strings/underscore}REPLACE:{Anchor Text Line 1
Anchor Text Line 2}
NEW${strings/underscore}TEXT:{Your New Text Here
Anchor Text Line 1
Anchor Text Line 2}
```
        * Will result in:
```
Your New Text Here
Anchor Text Line 1
Anchor Text Line 2
```
    * Never target _only_ a blank line (or a line _only_ containing whitespace) for replacement when inserting.
  * **Adding New Top-Level Code Blocks (Functions, Classes, etc.):**
    * **Goal:** To add entirely new, independent blocks of code (like a new function or class) to a file, typically at the end.
    * **Anchor Selection:**
      * Identify the **very last line** of the *last existing code block* in the file (e.g., the final indented line of the previous function, a closing brace '}', or a significant comment marking the end). This is your preferred TO${strings/underscore}REPLACE anchor.
      * Ensure this anchor line is unique.
    * **Insertion Strategy:** Always use the **Insert AFTER the Anchor** strategy described above.
    * **NEW${strings/underscore}TEXT Structure:** Construct NEW${strings/underscore}TEXT like this, including appropriate blank lines for code style (e.g., typically two newlines before a top-level Python function).
    * **CRITICAL WARNING:** **Never** use the definition line (e.g., 'def function_name(...):' or 'class ClassName:') of an *existing* function or class as the TO${strings/underscore}REPLACE anchor when trying to add a *new* function/class *after* it. This will break the existing code block. Always anchor to the *end* of the preceding block.
  * **Deleting Text:** There are two main approaches, but preserving context is generally safer.
    * **Method 1: Deleting *Within* Context (Safest & Recommended):**
      * This is the **preferred method** when deleting lines, sentences, or sections while ensuring the surrounding text remains correctly positioned.
      * **Apply the 'Cohesive Scope & Context Preservation' principle:**
        1. Identify a unique, cohesive block (paragraph, list, code block, ~3-5 lines) that includes *both* the text you want to delete *and* the surrounding text you need to keep.
        2. Place this *entire original block* into the TO${strings/underscore}REPLACE field. This block acts as the unique context anchor.
        3. Construct the NEW${strings/underscore}TEXT field by taking the *exact text from TO${strings/underscore}REPLACE* and **removing only the specific part** you intend to delete. The NEW${strings/underscore}TEXT will therefore contain the surrounding context from the original block, correctly modified.
      * **Example:** To delete the second bullet point from a list:
```
${strings/tool-prefix}DOC/EDIT{MyList.txt}
TO${strings/underscore}REPLACE:{* Item 1
* Item 2 (DELETE ME)
* Item 3}
NEW${strings/underscore}TEXT:{* Item 1
* Item 3}
END${strings/underscore}EDIT
```
      *  **Rationale:** This method explicitly tells the tool what the surrounding context *should* look like after the deletion, preventing accidental removal of adjacent lines. It uses the surrounding text as the 'anchor' within both TO${strings/underscore}REPLACE and NEW${strings/underscore}TEXT.
    * **Method 2: Deleting the *Entire* Specified Block (Use with Caution):**
      * This method is only suitable when the text in TO${strings/underscore}REPLACE is *exactly* and *only* the content you want to remove, and it doesn't contain any adjacent context that must be preserved in that specific TO${strings/underscore}REPLACE block.
      * Provide the exact, unique text block to delete in TO${strings/underscore}REPLACE.
      * Leave the NEW${strings/underscore}TEXT field completely empty (NEW${strings/underscore}TEXT:{}).
      * **Example:** Deleting a specific, isolated paragraph:
```
${strings/tool-prefix}DOC/EDIT{MyDoc.txt}
TO${strings/underscore}REPLACE:{This is an entire paragraph I want to remove.
It stands alone and is unique.}
NEW${strings/underscore}TEXT:{}
END${strings/underscore}EDIT
```
      * **Warning:** Be very careful with this method. If TO${strings/underscore}REPLACE accidentally includes lines *before* or *after* the intended deletion target (because you needed them to make the block unique), those lines will *also* be deleted because NEW${strings/underscore}TEXT is empty. If unsure, always prefer Method 1.