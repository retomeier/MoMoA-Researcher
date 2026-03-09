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

import { useState } from "react";
import { Text } from "@radix-ui/themes";
import cn from "classnames";
import styles from "./InlineTextEdit.module.scss";

// Define props that InlineTextEdit accepts, extending TextProps for styling
interface InlineTextEditProps {
  className?: string;
  placeholder?: string;
  value: string;
  onChange: (newValue: string) => void;
  disabled?: boolean;
  // Manually added Radix props used by consumers (ProjectPage.tsx)
  size?: "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
  weight?: "light" | "regular" | "medium" | "bold";
}

export function InlineTextEdit({
  className,
  value,
  placeholder,
  onChange,
  size,
  weight,
  disabled = false,
}: InlineTextEditProps) {
  let [editingValue, setEditingValue] = useState<string>();
  
  const textProps = { size, weight };

  return (
    <>
      {editingValue === undefined && (
        <button
          className={cn(className, "is-target", styles.inlineTextEditTarget, {
            "is-placeholder": !value,
            [styles.disabled]: disabled,
          })}
          aria-label={`${value} (Click to edit)`}
          onClick={() => !disabled && setEditingValue(value)}
          disabled={disabled}
        >
          <Text {...textProps}>
            {value || placeholder}
          </Text>
        </button>
      )}
      {editingValue !== undefined && (
        <input
          ref={(node) => {
            if (!node || document.activeElement === node) return;
            node.focus();
            node.select();
          }}
          placeholder={placeholder}
          className={cn(className, "is-editing", styles.inlineTextEditInput)}
          value={editingValue}
          onChange={(ev) => setEditingValue(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              ev.currentTarget.blur();
            } else if (ev.key === "Escape") {
              setEditingValue(undefined);
            }
          }}
          onBlur={() => {
            editingValue && onChange(editingValue);
            setEditingValue(undefined);
          }}
        />
      )}
    </>
  );
}
