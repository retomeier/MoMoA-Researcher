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

import { SVGAttributes } from "react";

export function Logo({
  size,
  ...props
}: SVGAttributes<SVGSVGElement> & {
  size?: number;
}) {
  return (
    <svg
      {...props}
      width={size || 64}
      height={size || 64}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="32" cy="32" r="32" fill="url(#a)" />
      <defs>
        <radialGradient
          id="a"
          cx="0"
          cy="0"
          r="1.5"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(15.8859 5.58127) rotate(37.5226) scale(47.4787 47.8005)"
        >
          <stop offset="0.109027" stopColor="#FAA68D" />
          <stop offset="0.465239" stopColor="#FFABF2" />
          <stop offset="0.795584" stopColor="#9682F8" />
          <stop offset="1" stopColor="#0091FF" />
        </radialGradient>
      </defs>
    </svg>
  );
}
