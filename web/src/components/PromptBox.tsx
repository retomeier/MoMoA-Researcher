/**
 * Copyright 2026 Reto Meier
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { fileToBase64Data, pickAndLoadFiles } from "@/util/file-upload";
import { normalizeRepoUrl } from "@/util/git-urls";
import { usePrefsContext } from "@/util/PrefsProvider";
import {
  Button,
  DropdownMenu,
  Flex,
  IconButton,
  Popover,
  Switch,
  Text,
  TextArea,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import cn from "classnames";
import {
  FileIcon,
  FilesIcon,
  FolderIcon,
  GithubIcon,
  PaperclipIcon,
  SendIcon,
  XIcon,
  ImageIcon, // Added for image attachment UI
} from "lucide-react";
import { Fragment, useMemo, useState, useRef } from "react"; // Added useRef
import styles from "./PromptBox.module.scss";
import { areRequiredPrefsSet } from "@/onboarding/RequiredPrefs";

export type PromptExtras = {
  attachments: Attachment[];
  notWorkingBuild: boolean;
  image?: string; // Base64 encoded image data
  imageMimeType?: string; // MIME type of the attached image
};

export type Attachment =
  | {
      type: "files";
      files: Array<{ path: string; textContent: string }>;
    }
  | {
      type: "git-repo";
      repoUrl: string;
    };

export function PromptBox({
  className,
  onSubmit,
  disabled,
  placeholder,
  supportsAttachments,
  supportsImages,
  supportsGitHub,
  showNotWorkingBuildOption,
}: {
  className?: string;
  onSubmit?: (
    prompt: string,
    extras: PromptExtras
  ) => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  placeholder?: string;
  supportsAttachments?: boolean;
  showNotWorkingBuildOption?: boolean;
  supportsImages?: boolean;
  supportsGitHub?: boolean;

}) {
  const { prefs } = usePrefsContext();
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notWorkingBuild, setNotWorkingBuild] = useState(false);
  const [imageFile, setImageFile] = useState<File | undefined>(undefined);
  
  // Use a ref to reference the specific input element for this instance
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (newFiles: { path: string; textContent: string }[]) => {
    if (newFiles.length === 0) return;
    setAttachments((prev) => {
      const existingIndex = prev.findIndex((a) => a.type === "files");
      if (existingIndex !== -1) {
        const newAttachments = [...prev];
        const existing = newAttachments[existingIndex];
        if (existing.type === "files") {
          newAttachments[existingIndex] = {
            ...existing,
            files: [...existing.files, ...newFiles],
          };
        }
        return newAttachments;
      }
      return [...prev, { type: "files", files: newFiles }];
    });
  };

  const globalDisabledReason = useMemo(() => {
    return areRequiredPrefsSet(prefs)
      ? ""
      : "Configure settings to get started";
  }, [prefs]);

  const [showGitRepoPopover, setShowGitRepoPopover] = useState(false);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!prompt.trim() || disabled || !!globalDisabledReason) {
      return;
    }

    let imageBase64: string | undefined = undefined;
    let imageMimeType: string | undefined = undefined;
    if (imageFile) {
      try {
        imageBase64 = await fileToBase64Data(imageFile);
        imageMimeType = imageFile.type;
      } catch (error) {
        console.error("Error converting image to Base64:", error);
        // If conversion fails, we proceed without the image.
      }
    }

    let ret = await onSubmit?.(prompt, { attachments, notWorkingBuild, image: imageBase64, imageMimeType });
    if (ret !== false) {
      setAttachments([]);
      setPrompt("");
      setImageFile(undefined); // Clear image file state
      
      // Clear the file input value so the same file can be selected again if needed
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className={cn(styles.promptBox, className)}>
      <form className={styles.promptContainer} action="" onSubmit={submit}>
        <TextArea
          autoFocus
          size="3"
          className={styles.prompt}
          placeholder={globalDisabledReason || placeholder || "Enter prompt"}
          value={prompt}
          rows={1}
          disabled={disabled || !!globalDisabledReason}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
              submit(ev);
            }
          }}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className={styles.bottomBar}>
          {showGitRepoPopover && (
            <GitRepoPopoover
              onClose={() => setShowGitRepoPopover(false)}
              onSave={(repoUrl) => {
                setAttachments((f) => [
                  ...f,
                  {
                    type: "git-repo",
                    repoUrl,
                  },
                ]);
              }}
            />
          )}
          {(supportsAttachments || supportsImages) && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <IconButton
                  radius="full"
                  type="button"
                  color="gray"
                  variant="ghost"
                  disabled={disabled || !!globalDisabledReason}
                >
                  <PaperclipIcon size={16} />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {supportsImages && (
                  <>
                  <DropdownMenu.Item
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    disabled={!!imageFile} // Disable if an image is already attached
                  >
                  <ImageIcon size={16} />
                    Attach image
                  </DropdownMenu.Item>
                </>
                )}
                {supportsAttachments && (
                  <>
                  {supportsImages && (
                  <>
                    <DropdownMenu.Separator />
                  </>
                  )}
                  <DropdownMenu.Item
                    onClick={async () => {
                      let files = await pickAndLoadFiles(false);
                      addFiles(files);
                    }}
                  >
                    <FilesIcon size={16} />
                    Upload files
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onClick={async () => {
                      let files = await pickAndLoadFiles(true);
                      addFiles(files);
                    }}
                  >
                    <FolderIcon size={16} />
                    Upload project
                  </DropdownMenu.Item>
                  {supportsGitHub && (
                  <>
                    <DropdownMenu.Item
                      onClick={() => {
                        setShowGitRepoPopover(true);
                      }}
                    >
                      <GithubIcon size={16} />
                      Git repo
                    </DropdownMenu.Item>
                  </>
                  )}
                  </>
                )}
                </DropdownMenu.Content>
            </DropdownMenu.Root>
          )}
          {(attachments.length > 0 || imageFile) && (
            <div className={styles.attachments}>
              {imageFile && (
                <Fragment key="image-attachment">
                  <Button
                    className={styles.attachmentChip}
                    variant="outline"
                    radius="full"
                    size="1"
                    color="gray"
                    onClick={() => {
                      setImageFile(undefined);
                      // Clear the input when removing the attachment
                      if (fileInputRef.current) {
                        fileInputRef.current.value = "";
                      }
                    }}
                  >
                    <ImageIcon size={16} />
                    {imageFile.name}
                    <XIcon size={16} />
                  </Button>
                </Fragment>
              )}
              {attachments.map((attachment, index) => (
                <Fragment key={index}>
                  <Button
                    className={styles.attachmentChip}
                    variant="outline"
                    radius="full"
                    size="1"
                    color="gray"
                    onClick={() =>
                      setAttachments((atts) =>
                        atts.filter((a) => a !== attachment)
                      )
                    }
                  >
                    {attachment.type === "files" && (
                      <>
                        <FileIcon size={16} />
                        {attachment.files.length > 1
                          ? `${attachment.files.length} files`
                          : attachment.files[0].path}
                      </>
                    )}
                    {attachment.type === "git-repo" && (
                      <>
                        <GithubIcon size={16} />
                        <span>
                          <span style={{ color: "var(--gray-10)" }}>
                            {normalizeRepoUrl(attachment.repoUrl).org + "/"}
                          </span>
                          {normalizeRepoUrl(attachment.repoUrl).repo}
                        </span>
                      </>
                    )}
                    <XIcon size={16} />
                  </Button>
                </Fragment>
              ))}
            </div>
          )}
          <div style={{ flex: 1, pointerEvents: "none" }} />
          <Tooltip content={"Send (Ctrl+Enter)"}>
            <IconButton
              radius="full"
              type="submit"
              color="gray"
              variant="ghost"
              disabled={disabled || !prompt.trim()}
            >
              <SendIcon size={16} />
            </IconButton>
          </Tooltip>
        </div>
      </form>
      {/* Hidden input for image selection using ref instead of ID */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            setImageFile(file);
          }
        }}
      />
      {showNotWorkingBuildOption && (
        <Tooltip content="Check this if you don't expect / require the files you've provided to build.">
          <Flex align="center" gap="2" style={{ marginTop: "8px" }}>
            <Switch
              checked={notWorkingBuild}
              onCheckedChange={setNotWorkingBuild}
            />
            <span style={{ color: "var(--gray-10)" }}>
              <Text size="2">Not a Working Build</Text>
            </span>
          </Flex>
        </Tooltip>
      )}
    </div>
  );
}

function GitRepoPopoover({
  onClose,
  onSave,
}: {
  onSave?: (repoUrl: string) => void;
  onClose?: () => void;
}) {
  const [repoUrl, setRepoUrl] = useState("");

  return (
    <Popover.Root open modal onOpenChange={(v) => !v && onClose?.()}>
      <Popover.Trigger>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
          }}
        />
      </Popover.Trigger>
      <Popover.Content className={styles.gitRepoPopover}>
        <TextField.Root
          value={repoUrl}
          placeholder="my-org/my-repo"
          onChange={(ev) => setRepoUrl(ev.currentTarget.value)}
          onFocus={(ev) => ev.currentTarget.select()}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              onSave?.(repoUrl);
              onClose?.();
            }
          }}
        >
          <TextField.Slot>
            <GithubIcon size={16} />
          </TextField.Slot>
        </TextField.Root>
      </Popover.Content>
    </Popover.Root>
  );
}
