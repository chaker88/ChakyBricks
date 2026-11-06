import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateSchema } from "@/hooks/use-api";
import { identifierError } from "@/lib/import";

export function NewSchemaDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const create = useCreateSchema();
  const error = name ? identifierError(name, "schema name") : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name || error) return;
    create.mutate(name, {
      onSuccess: () => {
        toast.success(`Created schema ${name}`);
        setName("");
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New schema</DialogTitle>
            <DialogDescription>
              Schemas group related tables, e.g. sales or staging.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Input
              autoFocus
              value={name}
              placeholder="schema_name"
              aria-invalid={!!error}
              onChange={(e) => setName(e.target.value.toLowerCase())}
            />
            <p className="min-h-4 text-xs text-destructive">{error ?? create.error?.message}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name || !!error || create.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
