"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { SegmentedControl } from "./SegmentedControl";

export interface SegmentNavOption<V extends string> {
  value: V;
  label: string;
  /** Where this segment lives: segments are URLs, so reloads and links keep them. */
  href: string;
}

export interface SegmentNavProps<V extends string> {
  label: string;
  options: readonly SegmentNavOption<V>[];
  value: V;
}

/**
 * A segmented control whose segments are pages ("Open / Behandeld"). The
 * thumb moves at once; the list follows when the server has answered.
 */
export function SegmentNav<V extends string>({
  label,
  options,
  value,
}: SegmentNavProps<V>) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <SegmentedControl
      label={label}
      options={options}
      defaultValue={value}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option)
          startTransition(() =>
            router.replace(option.href as Route, { scroll: false }),
          );
      }}
    />
  );
}
