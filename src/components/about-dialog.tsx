import { ExternalLink } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { APP_AUTHOR, APP_LICENSE, APP_LINKS, APP_NAME, APP_VERSION } from "@/lib/about";
import { openExternal } from "@/lib/external";

export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center">
          <LogoMark className="mb-2 size-12" />
          <DialogTitle className="text-xl">{APP_NAME}</DialogTitle>
          <DialogDescription>Version {APP_VERSION}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-center text-sm">
          <p>
            Created by <span className="font-medium">{APP_AUTHOR}</span>
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openExternal(APP_LINKS.website)}
            >
              Website
              <ExternalLink className="opacity-60" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => void openExternal(APP_LINKS.github)}>
              GitHub
              <ExternalLink className="opacity-60" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openExternal(APP_LINKS.linkedin)}
            >
              LinkedIn
              <ExternalLink className="opacity-60" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Copyright 2026 {APP_AUTHOR}. Licensed under the {APP_LICENSE}. ChakyBricks includes
            open-source software; see THIRD_PARTY_NOTICES.txt in the installation folder.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
