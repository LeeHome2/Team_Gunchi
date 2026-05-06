"""
Migration script to fix validation_results.model_id nullable constraint.

SQLite doesn't support ALTER COLUMN, so we need to:
1. Create a new table with correct schema
2. Copy data from old table
3. Drop old table
4. Rename new table

Run this script once to fix the database schema:
    python -m database.migrate_validation_results
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from database.config import engine
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def migrate():
    """Fix validation_results.model_id to allow NULL."""
    with engine.connect() as conn:
        # Check if migration is needed
        result = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='validation_results'"
        )
        row = result.fetchone()

        if not row:
            logger.info("validation_results table doesn't exist, skipping migration")
            return

        table_sql = row[0]

        # Check if model_id already allows NULL
        if 'model_id' in table_sql and 'NOT NULL' not in table_sql.split('model_id')[1].split(',')[0]:
            logger.info("model_id already allows NULL, skipping migration")
            return

        logger.info("Starting migration: validation_results.model_id -> nullable")

        # Create new table with correct schema
        conn.execute("""
            CREATE TABLE IF NOT EXISTS validation_results_new (
                id CHAR(32) PRIMARY KEY,
                project_id CHAR(32) NOT NULL REFERENCES projects(id),
                model_id CHAR(32) REFERENCES generated_models(id),
                is_valid BOOLEAN NOT NULL,
                building_coverage JSON NOT NULL,
                setback JSON NOT NULL,
                height_check JSON NOT NULL,
                violations JSON NOT NULL,
                zone_type VARCHAR(100),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
            )
        """)

        # Copy data
        conn.execute("""
            INSERT INTO validation_results_new
            SELECT id, project_id, model_id, is_valid, building_coverage,
                   setback, height_check, violations, zone_type, created_at
            FROM validation_results
        """)

        # Drop old table
        conn.execute("DROP TABLE validation_results")

        # Rename new table
        conn.execute("ALTER TABLE validation_results_new RENAME TO validation_results")

        # Recreate indexes
        conn.execute("CREATE INDEX IF NOT EXISTS idx_validation_project ON validation_results(project_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_validation_model ON validation_results(model_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_validation_valid ON validation_results(is_valid)")

        conn.commit()
        logger.info("Migration completed successfully!")


if __name__ == "__main__":
    migrate()
