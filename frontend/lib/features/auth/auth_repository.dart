import '../../core/api/api_client.dart';

class UserSession {
  const UserSession({
    required this.accessToken,
    required this.id,
    required this.email,
    required this.roles,
    required this.permissions,
    required this.storeIds,
  });

  final String accessToken;
  final String id;
  final String email;
  final List<String> roles;
  final List<String> permissions;
  final List<String> storeIds;
}

class AuthRepository {
  const AuthRepository(this._apiClient);
  final ApiClient _apiClient;

  Future<UserSession> login(String email, String password) async {
    final response = await _apiClient.dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'email': email, 'password': password},
    );
    final data = response.data!;
    final user = data['user'] as Map<String, dynamic>;
    final token = data['accessToken'] as String;
    _apiClient.setAccessToken(token);
    return UserSession(
      accessToken: token,
      id: user['id'] as String,
      email: user['email'] as String,
      roles: List<String>.from(user['roles'] as List),
      permissions: List<String>.from(user['permissions'] as List),
      storeIds: List<String>.from(user['storeIds'] as List),
    );
  }
}
