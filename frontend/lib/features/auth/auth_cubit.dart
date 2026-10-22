import 'package:dio/dio.dart';
import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/api/api_client.dart';
import 'auth_repository.dart';

abstract class AuthState extends Equatable {
  const AuthState();
  @override
  List<Object?> get props => [];
}

class Unauthenticated extends AuthState {
  const Unauthenticated({this.error});
  final String? error;
  @override
  List<Object?> get props => [error];
}

class AuthLoading extends AuthState {
  const AuthLoading();
}

class Authenticated extends AuthState {
  const Authenticated(this.session);
  final UserSession session;
  @override
  List<Object?> get props => [session.accessToken];
}

class AuthCubit extends Cubit<AuthState> {
  AuthCubit(this._repository, this._apiClient) : super(const Unauthenticated());
  final AuthRepository _repository;
  final ApiClient _apiClient;

  Future<void> login(String email, String password) async {
    emit(const AuthLoading());
    try {
      emit(Authenticated(await _repository.login(email.trim(), password)));
    } on DioException catch (error) {
      final message = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['error']?.toString()
          : null;
      emit(Unauthenticated(error: message ?? 'Unable to connect to the CRM API'));
    } catch (_) {
      emit(const Unauthenticated(error: 'Login failed. Check the API response.'));
    }
  }

  void logout() {
    _apiClient.setAccessToken(null);
    emit(const Unauthenticated());
  }
}
