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

import React from 'react';
import styles from './CodeBlock.module.scss';
import classNames from 'classnames';

interface CodeBlockProps {
  children: React.ReactNode;
  className?: string;
  wrap?: boolean; // Defaults to false for scrolling behavior
  maxHeight?: string; // e.g., "400px", "50vh"
  applyDefaultTheming?: boolean; // Defaults to true if not provided and no className, or if explicitly true
}

const CodeBlock: React.FC<CodeBlockProps> = ({
  children,
  className,
  wrap = false,
  maxHeight,
  applyDefaultTheming,
}) => {
  const shouldApplyTheming = applyDefaultTheming === true || (applyDefaultTheming === undefined && !className);

  const codeBlockClasses = classNames(
    styles.codeBlockBase,
    { [styles.wrap]: wrap },
    { [styles.codeBlockThemed]: shouldApplyTheming },
    className
  );

  return (
    <div className={codeBlockClasses}>
      <pre style={maxHeight ? { maxHeight } : undefined}>
        {children}
      </pre>
    </div>
  );
};

export default CodeBlock;