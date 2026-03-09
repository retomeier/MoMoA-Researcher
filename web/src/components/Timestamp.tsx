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

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import calendar from "dayjs/plugin/calendar";
import { ReactNode, useMemo } from "react";
dayjs.extend(relativeTime);
dayjs.extend(calendar);

export function Timestamp({
  timestamp,
  precise,
  fallback,
}: {
  timestamp?: number | null;
  fallback?: ReactNode;
  precise?: boolean;
}): ReactNode {
  let formatted = useMemo(
    () =>
      timestamp
        ? dayjs(timestamp)[precise ? "calendar" : "fromNow"]()
        : undefined,
    [timestamp, precise]
  );
  return formatted ?? fallback;
}
