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

import { useAuthContext } from "@/auth/AuthProvider";
import { db } from "@/firebase";
import {
  Button,
  Flex,
  IconButton,
  Popover,
  Text,
  TextArea,
  Tooltip,
} from "@radix-ui/themes";
import { child, push, ref } from "firebase/database";
import { MegaphoneIcon } from "lucide-react";
import { ComponentProps, useEffect, useMemo, useState } from "react";
import styles from "./SendFeedbackButton.module.scss";
import { useToast } from "./Toast";

const SPARKS_FREQUENCY_MIN = 10;
const SPARKS_PER_SECOND = 5;
const SPARKS_DURATION = 2500;
const NUM_SPARKS = Math.floor(SPARKS_PER_SECOND * (SPARKS_DURATION / 1000));

export function SendFeedbackButton({ feedbackKey }: { feedbackKey: string }) {
  const [showSparks, setShowSparks] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const { user } = useAuthContext();
  const { toast } = useToast();

  useEffect(() => {
    if (showSparks) {
      const timer = setTimeout(
        () => setShowSparks(false),
        SPARKS_DURATION + 1000,
      );
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(
        () => setShowSparks(true),
        SPARKS_FREQUENCY_MIN * 60 * 1000,
      );
      return () => clearTimeout(timer);
    }
  }, [showSparks]);

  const sendFeedback = async () => {
    if (!feedbackText.trim()) return;
    setFeedbackSent(true);
    try {
      if (!user?.uid) throw new Error("Not logged in");
      await push(child(ref(db, "feedback"), feedbackKey), {
        uid: user.uid,
        when: new Date().toISOString(),
        feedbackText,
      });
      setFeedbackText("");
    } catch (error) {
      console.error(error);
      toast("Failed to send feedback", { status: "error" });
      setFeedbackSent(false);
    }
  };

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (!open) {
          setTimeout(() => setFeedbackSent(false), 500);
        }
      }}
    >
      <Tooltip content="Send feedback">
        <Popover.Trigger>
          <IconButton
            variant="ghost"
            color="gray"
            radius="full"
            style={{ position: "relative" }}
            onMouseEnter={() => setShowSparks(true)}
            onClick={() => setShowSparks(false)}
          >
            <MegaphoneIcon size={20} />
            {showSparks && <EmojiSparks />}
          </IconButton>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Content width="360px">
        {feedbackSent && (
          <>
            <Flex direction="column" align="center" gap="2" p="4">
              <NotoEmoji emoji="🙏" width="32" height="32" />
              <Text size="2" color="gray">
                Thanks for your feedback!
              </Text>
            </Flex>
          </>
        )}
        {!feedbackSent && (
          <>
            <Flex direction="column" gap="2">
              <TextArea
                placeholder="What's working well? How can we improve?"
                value={feedbackText}
                rows={6}
                onChange={(e) => setFeedbackText(e.target.value)}
              />
              <Flex gap="1" align="center">
                <Text size="1" style={{ color: "var(--gray-10)" }}>
                  Your email address will be included
                </Text>
                <div style={{ flex: 1 }} />
                <Button
                  size="1"
                  onClick={sendFeedback}
                  disabled={!feedbackText.trim()}
                >
                  Send
                </Button>
              </Flex>
            </Flex>
          </>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

const EMOJI = ["😉", "🤔", "😡", "😂", "😍"];

function EmojiSparks() {
  const sparks = useMemo(
    () =>
      [...Array(NUM_SPARKS)].map((_, i) => ({
        emoji: EMOJI[Math.floor(Math.random() * EMOJI.length)],
        id: i,
        left: Math.random() * 100,
        delay: i * (SPARKS_DURATION / NUM_SPARKS / 1000),
        duration: 0.8 + Math.random() * 0.7,
        rotation: -30 + Math.random() * 60,
        size: 20 + Math.random() * 6,
      })),
    [],
  );

  return (
    <div className={styles.sparks}>
      {sparks.map((spark) => (
        <div
          key={spark.id}
          className={styles.spark}
          style={{
            left: `${spark.left}%`,
            animationDelay: `${spark.delay}s, ${spark.delay}s`,
            animationDuration: `${spark.duration}s, ${spark.duration}s`,
            rotate: `${spark.rotation}deg`,
            width: spark.size,
            height: spark.size,
          }}
        >
          <NotoEmoji emoji={spark.emoji} />
        </div>
      ))}
    </div>
  );
}

const NotoEmoji = ({
  emoji,
  ...props
}: { emoji: string } & ComponentProps<"img">) => (
  <img {...props} src={emojiSvgUrl(emoji)} />
);

function emojiSvgUrl(text: string) {
  return `https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u${emojiPath(text)}.svg`;
}

function emojiPath(input: string) {
  return emojiRaw(input)
    .split(" ")
    .map((val) => parseInt(val).toString(16))
    .join(" ");
}

function emojiRaw(input: string) {
  if (input.length === 1) {
    return input.charCodeAt(0).toString();
  } else if (input.length > 1) {
    let pairs = [];
    for (let i = 0; i < input.length; i++) {
      if (
        // high surrogate
        input.charCodeAt(i) >= 0xd800 &&
        input.charCodeAt(i) <= 0xdbff
      ) {
        if (
          input.charCodeAt(i + 1) >= 0xdc00 &&
          input.charCodeAt(i + 1) <= 0xdfff
        ) {
          // low surrogate
          pairs.push(
            (input.charCodeAt(i) - 0xd800) * 0x400 +
              (input.charCodeAt(i + 1) - 0xdc00) +
              0x10000,
          );
        }
      } else if (input.charCodeAt(i) < 0xd800 || input.charCodeAt(i) > 0xdfff) {
        // modifiers and joiners
        pairs.push(input.charCodeAt(i));
      }
    }
    return pairs.join(" ");
  }

  return "";
}
