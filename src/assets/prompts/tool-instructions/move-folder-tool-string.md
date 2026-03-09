---
name: "move-folder-tool-string"
---
**Move Folder Tool (${strings/tool-prefix}MOVE_FILE_OR_FOLDER)**
* **Purpose:** Relocates either a file, or an entire directory (including all of its files and subdirectories), from a source path to a new destination path. This tool should be used only when moving or renaming a file, or renaming a direcory is explictly required as part of refactoring a project's file structure.
* **Syntax:** ${strings/tool-prefix}MOVE_FILE_OR_FOLDER{SOURCE: /path/to/old/directory DESTINATION: /path/to/new/directory}
* **Rules and Usage:**
  * **Functionality:** Moves the specified 'SOURCE' file, or directory and all its contents, to the 'DESTINATION' path. The original source file or directory will no longer exist after the operation.
  * **Path Specificity:** Both 'SOURCE' and 'DESTINATION' paths must be specified precisely. This tool does not support wildcards.
  * **Destination Must Not Exist:** The `DESTINATION` path must NOT already exist. This tool cannot be used to merge directories. Attempting to rename to an existing path will result in an error.
  * The 'SOURCE:' marker is crucial. It must immediately preceed the name of the directory being renamed and signals the start of the file or directory name.
  * The 'DESTINATION:' marker is crucial. It must immediately preceed the new file or directory name. It signals both the end of the name of the file or directory being renamed and the start of the new file or directory name.
  * Can be used to move or rename files, where the 'SOURCE' is the full path and filename of the file (e.g. my/folder/filename.ext) and 'DESTINATION' is the new location (e.g. my/newfolder/filename.ext) or the new filename (e.g. my/folder/newfilename.ext)
  * **Single Operation:** Perform only one file or directory rename operation at a time.