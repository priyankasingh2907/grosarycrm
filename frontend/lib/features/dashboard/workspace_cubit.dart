import 'package:dio/dio.dart';
import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/api/api_client.dart';

class WorkspaceState extends Equatable {
  const WorkspaceState({this.section = 'home', this.rows = const [], this.loading = false, this.error});
  final String section;
  final List<Map<String, dynamic>> rows;
  final bool loading;
  final String? error;

  WorkspaceState copyWith({String? section, List<Map<String, dynamic>>? rows, bool? loading, String? error, bool clearError = false}) => WorkspaceState(
        section: section ?? this.section,
        rows: rows ?? this.rows,
        loading: loading ?? this.loading,
        error: clearError ? null : error ?? this.error,
      );

  @override
  List<Object?> get props => [section, rows, loading, error];
}

class WorkspaceCubit extends Cubit<WorkspaceState> {
  WorkspaceCubit(this._api) : super(const WorkspaceState());
  final ApiClient _api;

  static const endpoints = {
    'home': '/dashboard/summary',
    'catalog': '/catalog/products',
    'inventory': '/inventory/balances',
    'transfers': '/inventory/transfers',
    'movements': '/inventory/movements',
    'expiry': '/inventory/expiring',
    'purchases': '/purchases',
    'customers': '/customers',
    'sales': '/sales',
    'cash': '/operations/cash/current',
    'expenses': '/operations/expenses',
    'reports': '/reports/sales-daily',
    'users': '/admin/users',
    'roles': '/admin/roles',
    'stores': '/stores',
  };

  Future<void> select(String section) async {
    emit(state.copyWith(section: section, rows: const [], loading: true, clearError: true));
    await refresh();
  }

  Future<void> refresh() async {
    emit(state.copyWith(loading: true, clearError: true));
    try {
      final response = await _api.dio.get<dynamic>(endpoints[state.section] ?? '/dashboard/summary');
      final data = response.data;
      final List<Map<String, dynamic>> rows;
      if (data is List) {
        rows = data.cast<Map<String, dynamic>>();
      } else if (data is Map<String, dynamic> && data['items'] is List) {
        rows = (data['items'] as List).cast<Map<String, dynamic>>();
      } else if (data is Map<String, dynamic>) {
        rows = [data];
      } else {
        rows = const [];
      }
      emit(state.copyWith(rows: rows, loading: false));
    } on DioException catch (error) {
      final message = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['error']?.toString()
          : null;
      emit(state.copyWith(loading: false, error: message ?? 'Unable to load this section.'));
    } catch (_) {
      emit(state.copyWith(loading: false, error: 'The API returned an unexpected response.'));
    }
  }

  Future<Map<String, dynamic>?> post(String path, Map<String, dynamic> body) async {
    try {
      final response = await _api.dio.post<Map<String, dynamic>>(path, data: body);
      await refresh();
      return response.data;
    } on DioException catch (error) {
      final message = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['error']?.toString()
          : null;
      emit(state.copyWith(error: message ?? 'The action could not be completed.'));
      rethrow;
    }
  }
}
