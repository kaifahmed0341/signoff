"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">No money moved because of this error. Try again, and if it keeps happening, reload the page.</p>
        {error.digest && <p className="mt-2 font-mono text-xs text-muted-foreground">Reference {error.digest}</p>}
        <Button className="mt-6" onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
