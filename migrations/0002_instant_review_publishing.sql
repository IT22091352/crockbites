-- CrockBites: Instant Review Publishing Migration
-- Non-destructively converts all existing pending reviews to approved
-- while preserving all review content, author details, ratings, and timestamps.

UPDATE reviews
SET status = 'approved'
WHERE status = 'pending';

