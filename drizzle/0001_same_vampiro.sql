CREATE TABLE `batchParticipants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchId` int NOT NULL,
	`organizationId` int NOT NULL,
	`access` enum('owner','collaborator','observer') NOT NULL DEFAULT 'collaborator',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `batchParticipants_id` PRIMARY KEY(`id`),
	CONSTRAINT `batch_participants_batch_org_idx` UNIQUE(`batchId`,`organizationId`)
);
--> statement-breakpoint
CREATE TABLE `organizationMembers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('farmer','fpo_operator','trader','logistics_operator','warehouse_operator','government_investigator','government_supervisor') NOT NULL,
	`status` enum('active','suspended') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizationMembers_id` PRIMARY KEY(`id`),
	CONSTRAINT `organization_members_org_user_idx` UNIQUE(`organizationId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`type` enum('farm','fpo','trader','logistics','warehouse','government') NOT NULL,
	`district` varchar(100),
	`state` varchar(100),
	`createdById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `batchEvents` ADD `createdById` int;--> statement-breakpoint
ALTER TABLE `batchEvents` ADD `actorOrganizationId` int;--> statement-breakpoint
ALTER TABLE `batches` ADD `ownerOrganizationId` int;--> statement-breakpoint
ALTER TABLE `batches` ADD `publicVerificationEnabled` enum('yes','no') DEFAULT 'yes' NOT NULL;--> statement-breakpoint
CREATE INDEX `batch_participants_organization_idx` ON `batchParticipants` (`organizationId`);--> statement-breakpoint
CREATE INDEX `organization_members_user_idx` ON `organizationMembers` (`userId`);--> statement-breakpoint
CREATE INDEX `organizations_type_idx` ON `organizations` (`type`);--> statement-breakpoint
CREATE INDEX `organizations_created_by_idx` ON `organizations` (`createdById`);--> statement-breakpoint
CREATE INDEX `batch_events_created_by_idx` ON `batchEvents` (`createdById`);--> statement-breakpoint
CREATE INDEX `batches_owner_organization_idx` ON `batches` (`ownerOrganizationId`);