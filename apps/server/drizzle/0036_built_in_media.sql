CREATE TABLE "hidden_media" (
	"host_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	CONSTRAINT "hidden_media_host_id_media_id_pk" PRIMARY KEY("host_id","media_id")
);
--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "host_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "hidden_media" ADD CONSTRAINT "hidden_media_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hidden_media" ADD CONSTRAINT "hidden_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;