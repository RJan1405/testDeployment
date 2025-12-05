from django.contrib import admin
from django.utils.html import format_html
from .models import Project, Message, UserProfile


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):

    # WHAT YOU SEE IN LIST VIEW
    list_display = [
        'id',
        'get_message_type',
        'sender',
        'get_recipient',
        'preview',
        'timestamp',
        'is_read'
    ]

    list_filter = ['timestamp', 'is_read', 'project']
    search_fields = ['sender__username', 'receiver__username', 'project__name']
    date_hierarchy = 'timestamp'

    # ONLY READABLE FIELDS, NO encrypted_text
    readonly_fields = [
        'sender',
        'receiver',
        'project',
        'timestamp',
        'decrypted_text',
        'file',
    ]

    # NO encrypted_text in form— EVER!
    fieldsets = (
        ('Message Content', {
            'fields': (
                'decrypted_text',
                'file',
            )
        }),
        ('Meta Info', {
            'fields': (
                'sender',
                'receiver',
                'project',
                'timestamp',
                'is_read',
            )
        }),
    )

    # --- CUSTOM ADMIN DISPLAY HELPERS ---

    def decrypted_text(self, obj):
        """Show decrypted message text (from @property)."""
        return obj.text or ""
    decrypted_text.short_description = "Decrypted Text"

    def preview(self, obj):
        """Short trimmed preview."""
        text = obj.text or ""
        return (text[:60] + "...") if len(text) > 60 else text
    preview.short_description = "Preview"

    def get_message_type(self, obj):
        if obj.project:
            return format_html('<span style="color: green;">Project</span>')
        return format_html('<span style="color: blue;">DM</span>')
    get_message_type.short_description = 'Type'

    def get_recipient(self, obj):
        if obj.receiver:
            return obj.receiver.username
        return obj.project.name if obj.project else "—"
    get_recipient.short_description = 'Recipient'


# --- PROJECT ADMIN (unchanged) ---
@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ['name', 'member_count', 'created_at', 'created_by']
    search_fields = ['name', 'description']
    filter_horizontal = ['members']
    readonly_fields = ['created_at', 'updated_at', 'created_by']

    def member_count(self, obj):
        return obj.members.count()
    member_count.short_description = 'Members'

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)


# --- USER PROFILE ADMIN (unchanged) ---
@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'is_online_badge', 'last_seen']
    list_filter = ['is_online', 'last_seen']
    search_fields = ['user__username', 'user__email']
    readonly_fields = ['last_seen']

    def is_online_badge(self, obj):
        if obj.is_online:
            return format_html('<span style="color: green;">●</span> Online')
        return format_html('<span style="color: gray;">●</span> Offline')
    is_online_badge.short_description = 'Status'
