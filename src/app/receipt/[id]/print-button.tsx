"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return <Button variant="outline" onClick={() => window.print()}><Printer /> Print or save as PDF</Button>;
}
