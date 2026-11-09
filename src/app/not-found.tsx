import Link from "next/link";
import { Brand } from "@/components/app/brand";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="max-w-sm text-center">
        <div className="flex justify-center mb-6"><Brand /></div>
        <h1 className="text-xl font-semibold">This page does not exist</h1>
        <p className="mt-2 text-sm text-muted-foreground">If someone sent you a link, it may have been replaced. Ask them for the current one.</p>
        <Link href="/" className={buttonVariants({ variant: "outline", className: "mt-6" })}>Go to the front page</Link>
      </div>
    </div>
  );
}
