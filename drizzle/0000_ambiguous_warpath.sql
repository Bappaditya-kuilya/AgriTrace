CREATE TABLE `anomalies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchId` int NOT NULL,
	`batchEventId` int NOT NULL,
	`category` enum('price','quantity','logistics','quality') NOT NULL,
	`severity` enum('info','warning','high') NOT NULL,
	`observedValue` varchar(120) NOT NULL,
	`expectedValue` varchar(120) NOT NULL,
	`deltaPercent` decimal(8,2),
	`explanation` text NOT NULL,
	`status` enum('open','resolved') NOT NULL DEFAULT 'open',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	CONSTRAINT `anomalies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `batchEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchId` int NOT NULL,
	`eventCode` varchar(64) NOT NULL,
	`eventType` enum('harvest','collection','quality_inspection','trader_offer','transit','warehouse_receipt','retail_receipt') NOT NULL,
	`actorLabel` varchar(160) NOT NULL,
	`sourceKind` enum('manual','sensor','inspector','system') NOT NULL DEFAULT 'manual',
	`location` varchar(180) NOT NULL,
	`occurredAt` timestamp NOT NULL,
	`quantityKg` decimal(12,2),
	`pricePerKg` decimal(10,2),
	`qualityGrade` varchar(40),
	`transitHours` decimal(8,2),
	`temperatureBreachMinutes` int,
	`payloadJson` text,
	`previousHash` varchar(64),
	`eventHash` varchar(64) NOT NULL,
	`integrityStatus` enum('verified','review') NOT NULL DEFAULT 'verified',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `batchEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `batch_events_code_idx` UNIQUE(`eventCode`)
);
--> statement-breakpoint
CREATE TABLE `batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchCode` varchar(64) NOT NULL,
	`crop` varchar(80) NOT NULL,
	`variety` varchar(120),
	`grade` varchar(40),
	`originDistrict` varchar(100) NOT NULL,
	`originState` varchar(100) NOT NULL,
	`producerLabel` varchar(160) NOT NULL,
	`harvestQuantityKg` decimal(12,2) NOT NULL,
	`currentQuantityKg` decimal(12,2) NOT NULL,
	`status` enum('draft','harvested','collected','in_transit','received','closed') NOT NULL DEFAULT 'draft',
	`createdById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `batches_id` PRIMARY KEY(`id`),
	CONSTRAINT `batches_batchCode_unique` UNIQUE(`batchCode`)
);
--> statement-breakpoint
CREATE TABLE `marketReferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`crop` varchar(80) NOT NULL,
	`market` varchar(140) NOT NULL,
	`district` varchar(100) NOT NULL,
	`minPricePerKg` decimal(10,2) NOT NULL,
	`maxPricePerKg` decimal(10,2) NOT NULL,
	`sourceLabel` varchar(180) NOT NULL,
	`effectiveAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketReferences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE INDEX `anomalies_batch_status_idx` ON `anomalies` (`batchId`,`status`);--> statement-breakpoint
CREATE INDEX `anomalies_event_idx` ON `anomalies` (`batchEventId`);--> statement-breakpoint
CREATE INDEX `batch_events_batch_occurred_idx` ON `batchEvents` (`batchId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `batches_status_idx` ON `batches` (`status`);--> statement-breakpoint
CREATE INDEX `batches_created_by_idx` ON `batches` (`createdById`);--> statement-breakpoint
CREATE INDEX `market_reference_crop_district_idx` ON `marketReferences` (`crop`,`district`);