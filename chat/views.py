# chat/views.py - FULLY FIXED VERSION

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
import os
import json
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import LoginView
from django.shortcuts import render, redirect, get_object_or_404
from django.db.models import Q, F
from django.views.generic import TemplateView
from django.utils.decorators import method_decorator
from .models import Message, Project
from .serializers import (
    MessageSerializer, UserSerializer, ProjectSerializer,
    MessageCreateSerializer, RecentChatSerializer
)

# ==================== LOGIN VIEW ====================

class CustomLoginView(LoginView):
    """Custom login view"""
    template_name = 'login.html'
    redirect_authenticated_user = True

    def get_success_url(self):
        return '/chat/'

# ==================== AUTHENTICATION ====================

class IsAuthenticatedPermission(permissions.BasePermission):
    """Custom permission to check if user is authenticated"""
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated

# ==================== API VIEWS ====================

class UserViewSet(viewsets.ModelViewSet):
    """
    API endpoints for users:
    - GET /api/users/ - List all users
    - GET /api/users/{id}/ - Get user detail
    - GET /api/users/search/?q=query - Search users
    """
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticatedPermission]

    @action(detail=False, methods=['get'])
    def search(self, request):
        """Search users by username or email"""
        q = request.query_params.get('q', '')
        if len(q) < 1:
            return Response([], status=status.HTTP_400_BAD_REQUEST)
        users = User.objects.filter(
            Q(username__icontains=q) | Q(email__icontains=q)
        ).exclude(id=request.user.id)[:20]
        serializer = self.get_serializer(users, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def me(self, request):
        """Get current user info"""
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def block(self, request, pk=None):
        """Block a user (current user blocks target)."""
        try:
            target = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        if target.id == request.user.id:
            return Response({'error': 'Cannot block yourself'}, status=status.HTTP_400_BAD_REQUEST)

        from .models import BlockedUser
        obj, created = BlockedUser.objects.get_or_create(blocker=request.user, blocked=target)
        return Response({'blocked_user_id': target.id, 'created': created})

    @action(detail=True, methods=['post'])
    def unblock(self, request, pk=None):
        """Unblock a user."""
        try:
            target = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        from .models import BlockedUser
        BlockedUser.objects.filter(blocker=request.user, blocked=target).delete()
        return Response({'unblocked_user_id': target.id})

    @action(detail=False, methods=['get'])
    def blocked(self, request):
        """List IDs of users blocked by current user."""
        from .models import BlockedUser
        ids = list(BlockedUser.objects.filter(blocker=request.user).values_list('blocked_id', flat=True))
        return Response({'blocked': ids})


class ProjectViewSet(viewsets.ModelViewSet):
    """
    API endpoints for projects:
    - GET /api/projects/ - List user's projects
    - POST /api/projects/ - Create project
    - GET /api/projects/{id}/ - Get project detail
    """
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticatedPermission]
    parser_classes = (MultiPartParser, FormParser)

    def get_queryset(self):
        """Only return projects the user is member of"""
        return Project.objects.filter(members=self.request.user)

    def perform_create(self, serializer):
        """Create project with current user as creator"""
        project = serializer.save(created_by=self.request.user)
        project.members.add(self.request.user)


class MessageViewSet(viewsets.ModelViewSet):
    """
    API endpoints for messages:
    - GET /api/messages/user/{id}/ - Get DM with user
    - GET /api/messages/project/{id}/ - Get project messages
    - POST /api/messages/send/ - Send message
    - GET /api/messages/recent_chats/ - Get recent conversations
    """
    serializer_class = MessageSerializer
    permission_classes = [IsAuthenticatedPermission]
    parser_classes = (MultiPartParser, FormParser)

    @action(detail=False, methods=['get'], url_path='user/(?P<user_id>[^/.]+)')
    def get_user_messages(self, request, user_id=None):
        """Get DM conversation with specific user"""
        try:
            other_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        messages = Message.objects.filter(
            Q(sender=request.user, receiver=other_user) |
            Q(sender=other_user, receiver=request.user)
        ).order_by('timestamp', 'id')

        # Mark as read
        Message.objects.filter(
            sender=other_user, receiver=request.user, is_read=False
        ).update(is_read=True)

        serializer = self.get_serializer(messages, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='project/(?P<project_id>[^/.]+)')
    def get_project_messages(self, request, project_id=None):
        """Get messages for a project"""
        try:
            project = Project.objects.get(id=project_id)
        except Project.DoesNotExist:
            return Response({'error': 'Project not found'}, status=status.HTTP_404_NOT_FOUND)

        if request.user not in project.members.all():
            return Response({'error': 'Not a member of this project'}, status=status.HTTP_403_FORBIDDEN)

        messages = project.messages.all().order_by('timestamp', 'id')

        # Mark as read
        messages.filter(is_read=False).exclude(sender=request.user).update(is_read=True)

        serializer = self.get_serializer(messages, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def send(self, request):
        """Send a message"""
        serializer = MessageCreateSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def recent_chats(self, request):
        """Get recent conversations - FIXED VERSION"""
        
        # Get all messages involving this user, ordered by most recent
        recent_messages = Message.objects.filter(
            Q(sender=request.user) | Q(receiver=request.user)
        ).order_by('-timestamp', '-id')

        # Group by conversation
        conversations_dict = {}
        
        for msg in recent_messages:
            # Determine who the other user is
            if msg.sender == request.user and msg.receiver:
                other_user = msg.receiver
            elif msg.receiver == request.user and msg.sender:
                other_user = msg.sender
            else:
                # Project message or no receiver, skip
                continue

            # Only add if we haven't seen this conversation yet
            if other_user.id not in conversations_dict:
                # Count unread messages from this user
                unread_count = Message.objects.filter(
                    sender=other_user,
                    receiver=request.user,
                    is_read=False
                ).count()

                conversations_dict[other_user.id] = {
                    'user': other_user,
                    'last_message': msg,
                    'unread_count': unread_count
                }

        # Serialize the conversations
        conversations_list = list(conversations_dict.values())
        serializer = RecentChatSerializer(conversations_list, many=True)
        return Response(serializer.data)

# ==================== PAGE VIEWS ====================

@login_required(login_url='login')
def chat_index(request):
    """Main chat interface"""
    user_projects = Project.objects.filter(members=request.user)
    # Get TURN config from env var
    try:
        turn_config = json.loads(os.environ.get('TURN_CONFIG', '[]'))
    except json.JSONDecodeError:
        turn_config = []
    
    context = {
        'user': request.user,
        'projects': user_projects,
        'turn_config': turn_config
    }
    return render(request, 'chat/index.html', context)

@login_required(login_url='login')
def chat_window(request, chat_type, chat_id):
    """Chat window for specific DM or project"""
    context = {
        'chat_type': chat_type,
        'chat_id': chat_id,
        'current_user': request.user
    }
    return render(request, 'chat/chat_window.html', context)

# ==================== DEBUG SEND MESSAGE ENDPOINT ====================

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

@csrf_exempt
@login_required(login_url='login')
def send_message_test(request):
    """Temporary CSRF-exempt endpoint to test message sending."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    text = request.POST.get("text", "").strip()
    receiver_id = request.POST.get("receiver")
    project_id = request.POST.get("project")

    if not text:
        return JsonResponse({"error": "text required"}, status=400)

    receiver = None
    project = None

    if receiver_id:
        try:
            receiver = User.objects.get(id=int(receiver_id))
        except:
            return JsonResponse({"error": "invalid receiver"}, status=400)

    if project_id:
        try:
            project = Project.objects.get(id=int(project_id))
        except:
            return JsonResponse({"error": "invalid project"}, status=400)

    msg = Message(sender=request.user, receiver=receiver, project=project)
    msg.text = text
    msg.save()

    return JsonResponse({
        "id": msg.id,
        "text": msg.text,
        "timestamp": msg.timestamp.isoformat() if hasattr(msg, "timestamp") else None,
        "sender": {
            "id": msg.sender.id,
            "username": msg.sender.username
        },
        "receiver": receiver.id if receiver else None,
        "project": project.id if project else None,
    }, status=201)
