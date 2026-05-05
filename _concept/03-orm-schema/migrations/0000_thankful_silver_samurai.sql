CREATE TABLE "diagrams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owned_by" uuid NOT NULL,
	"title" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagrams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "diagrams_select_own" ON "diagrams" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("diagrams"."owned_by" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "diagrams_insert_own" ON "diagrams" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("diagrams"."owned_by" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "diagrams_update_own" ON "diagrams" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("diagrams"."owned_by" = (select auth.uid())) WITH CHECK ("diagrams"."owned_by" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "diagrams_delete_own" ON "diagrams" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("diagrams"."owned_by" = (select auth.uid()));