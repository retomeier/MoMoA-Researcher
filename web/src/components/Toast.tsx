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

import * as Toast from "@radix-ui/react-toast";
import { AlertTriangleIcon, CheckIcon, LucideIcon, XIcon } from "lucide-react";
import React, {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./Toast.module.scss";
import { IconButton } from "@radix-ui/themes";
import cn from "classnames";

interface Toast {
  id?: number;
  hideTime?: number;
  message: string;
  detail?: string;
  duration?: number;
  status?: "info" | "error" | "success";
}

const ToastContext = createContext<{
  setToasts: React.Dispatch<React.SetStateAction<Toast[]>>;
}>({} as any);

export const ToastProvider = ({ children }: PropsWithChildren) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (!toasts.filter((t) => t.hideTime).length) return;
    let to = setTimeout(() => {
      setToasts((toasts) => toasts.filter((t) => !t.hideTime));
    }, 2000);
    return () => clearTimeout(to);
  }, [toasts]);

  return (
    <ToastContext.Provider value={{ setToasts }}>
      {children}
      <Toast.Provider swipeDirection="right">
        {toasts.map((props) => (
          <SingleToast {...props} key={props.id} />
        ))}
        <Toast.Viewport className={styles.viewport} />
      </Toast.Provider>
    </ToastContext.Provider>
  );
};

const SingleToast = ({
  id,
  message,
  detail,
  status,
  hideTime,
  duration,
}: Toast) => {
  const { setToasts } = useContext(ToastContext);
  const timerRef = useRef<NodeJS.Timeout | undefined>();
  const hidden = hideTime !== undefined;

  const removeToast = () => {
    setToasts((toasts) =>
      toasts.map((toast) =>
        toast.id === id ? { ...toast, hideTime: Date.now() } : toast
      )
    );
    timerRef.current && clearTimeout(timerRef.current);
  };

  useEffect(() => {
    if (duration === 0) return;
    timerRef.current = setTimeout(() => {
      removeToast();
      clearTimeout(timerRef.current);
    }, duration);
  }, []);

  const Icon = (
    {
      info: undefined,
      error: AlertTriangleIcon,
      success: CheckIcon,
    } satisfies Record<NonNullable<Toast["status"]>, LucideIcon | undefined>
  )[status || "info"];

  return (
    <Toast.Root
      className={cn(styles.toastContainer, { [styles.hidden]: hidden })}
      duration={Infinity}
    >
      <div data-status={status} className={styles.toast}>
        {Icon && <Icon size={16} className={styles.icon} />}
        <Toast.Title className={styles.message}>{message}</Toast.Title>
        <Toast.Description className={styles.detail}>
          {detail}
        </Toast.Description>
        {!duration && (
          <div className={styles.actions}>
            <Toast.Action asChild altText="Dismiss">
              <Toast.Close aria-label="Close" asChild>
                <IconButton
                  color="gray"
                  radius="full"
                  variant="ghost"
                  onClick={removeToast}
                >
                  <XIcon size={16} />
                </IconButton>
              </Toast.Close>
            </Toast.Action>
          </div>
        )}
      </div>
    </Toast.Root>
  );
};

export const useToast = () => {
  const { setToasts } = useContext(ToastContext);

  return useMemo(
    () => ({
      toast: (
        message: string,
        {
          duration = 3000,
          ...toast
        }: Omit<Toast, "message" | "hideTime" | "id"> = {}
      ) => {
        const id = Date.now() + Math.random();
        setToasts((toasts) => [...toasts, { id, message, duration, ...toast }]);
      },
    }),
    []
  );
};
