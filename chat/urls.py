# chat/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    chat_index, chat_window,
    UserViewSet, ProjectViewSet, MessageViewSet,
    send_message_test
)

# ---------------------------
# REST FRAMEWORK ROUTER SETUP
# ---------------------------
router = DefaultRouter()
router.register(r'users', UserViewSet, basename='users')
router.register(r'projects', ProjectViewSet, basename='projects')
router.register(r'messages', MessageViewSet, basename='messages')

# ---------------------------
# URLPATTERNS
# ---------------------------
urlpatterns = [
    # Main chat interface
    path('', chat_index, name='chat_index'),

    # DM / Project windows
    path('<str:chat_type>/<int:chat_id>/', chat_window, name='chat_window'),

    # Debug fallback endpoint (for testing message sending)
    path('send_test/', send_message_test, name='send_message_test'),

    # API routes (prefix = /chat/api/)
    path('api/', include(router.urls)),
]
