import 'package:dio/dio.dart';
import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'dashboard_repository.dart';

abstract class DashboardState extends Equatable {
  const DashboardState();
  @override
  List<Object?> get props => [];
}

class DashboardLoading extends DashboardState {
  const DashboardLoading();
}

class DashboardLoaded extends DashboardState {
  const DashboardLoaded(this.summary);
  final DashboardSummary summary;
  @override
  List<Object?> get props => [summary.roles, summary.stores, summary.lowStockProducts, summary.todaySales, summary.pendingPurchases];
}

class DashboardFailure extends DashboardState {
  const DashboardFailure(this.message);
  final String message;
  @override
  List<Object?> get props => [message];
}

class DashboardCubit extends Cubit<DashboardState> {
  DashboardCubit(this._repository) : super(const DashboardLoading());
  final DashboardRepository _repository;

  Future<void> load() async {
    emit(const DashboardLoading());
    try {
      emit(DashboardLoaded(await _repository.loadSummary()));
    } on DioException catch (error) {
      final status = error.response?.statusCode;
      emit(DashboardFailure(status == 401 || status == 403
          ? 'Your session does not have access to this dashboard.'
          : 'Could not load dashboard. Check your API connection.'));
    } catch (_) {
      emit(const DashboardFailure('Could not read dashboard data from the API.'));
    }
  }
}
