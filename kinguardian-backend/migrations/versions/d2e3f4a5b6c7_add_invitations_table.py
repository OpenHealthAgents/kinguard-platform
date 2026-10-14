"""add_invitations_table

Revision ID: d2e3f4a5b6c7
Revises: c1a2b3d4e5f6
Create Date: 2026-10-14 07:35:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'd2e3f4a5b6c7'
down_revision = 'c1a2b3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'invitations',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('family_id', sa.Uuid(), nullable=False),
        sa.Column('subject_id', sa.Uuid(), nullable=False),
        sa.Column('invited_by_profile_id', sa.Uuid(), nullable=False),
        sa.Column('channel', sa.String(length=32), server_default='whatsapp', nullable=False),
        sa.Column('destination', sa.String(length=255), nullable=False),
        sa.Column('invitee_name', sa.String(length=160), nullable=True),
        sa.Column('role', sa.String(length=32), server_default='parent', nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=24), server_default='pending', nullable=False),
        sa.Column('delivery_status', sa.String(length=32), server_default='pending', nullable=False),
        sa.Column('provider_message_id', sa.String(length=255), nullable=True),
        sa.Column('resend_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('last_sent_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('declined_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error_detail', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['family_id'], ['families.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['subject_id'], ['care_subjects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['invited_by_profile_id'], ['profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_invitations_family_id', 'invitations', ['family_id'], unique=False)
    op.create_index('ix_invitations_subject_id', 'invitations', ['subject_id'], unique=False)
    op.create_index('ix_invitations_invited_by_profile_id', 'invitations', ['invited_by_profile_id'], unique=False)
    op.create_index('ix_invitations_destination', 'invitations', ['destination'], unique=False)
    op.create_index('ix_invitations_token_hash', 'invitations', ['token_hash'], unique=True)
    op.create_index('ix_invitations_status', 'invitations', ['status'], unique=False)
    op.create_index('ix_invitations_provider_message_id', 'invitations', ['provider_message_id'], unique=False)
    op.create_index('ix_invitations_expires_at', 'invitations', ['expires_at'], unique=False)


def downgrade():
    op.drop_index('ix_invitations_expires_at', table_name='invitations')
    op.drop_index('ix_invitations_provider_message_id', table_name='invitations')
    op.drop_index('ix_invitations_status', table_name='invitations')
    op.drop_index('ix_invitations_token_hash', table_name='invitations')
    op.drop_index('ix_invitations_destination', table_name='invitations')
    op.drop_index('ix_invitations_invited_by_profile_id', table_name='invitations')
    op.drop_index('ix_invitations_subject_id', table_name='invitations')
    op.drop_index('ix_invitations_family_id', table_name='invitations')
    op.drop_table('invitations')
