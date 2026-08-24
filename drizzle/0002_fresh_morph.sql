CREATE TABLE `membershipRequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`requesterUserId` int NOT NULL,
	`requestedRole` enum('farmer','fpo_operator','trader','logistics_operator','warehouse_operator','government_investigator','government_supervisor') NOT NULL,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`reviewedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`reviewedAt` timestamp,
	CONSTRAINT `membershipRequests_id` PRIMARY KEY(`id`),
	CONSTRAINT `membership_requests_org_requester_idx` UNIQUE(`organizationId`,`requesterUserId`)
);
--> statement-breakpoint
CREATE INDEX `membership_requests_org_status_idx` ON `membershipRequests` (`organizationId`,`status`);--> statement-breakpoint
CREATE INDEX `membership_requests_requester_idx` ON `membershipRequests` (`requesterUserId`);