from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.contrib.auth import views as auth_views
from django.views.generic import RedirectView
from chat.views import CustomLoginView, signup_view

urlpatterns = [
    path('', RedirectView.as_view(url='/chat/', permanent=False), name='home'),

    path('admin/', admin.site.urls),

    path('login/', CustomLoginView.as_view(), name='login'),
    path('signup/', signup_view, name='signup'),
    path('logout/', auth_views.LogoutView.as_view(next_page='login'), name='logout'),

    path('chat/', include('chat.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
