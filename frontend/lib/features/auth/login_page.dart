import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'auth_cubit.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _submit() {
    if (_formKey.currentState!.validate()) {
      context.read<AuthCubit>().login(_email.text, _password.text);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Card(
              elevation: 0,
              color: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(24),
                side: const BorderSide(color: Color(0xFFE5ECE7)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Container(
                          width: 54,
                          height: 54,
                          decoration: BoxDecoration(color: colors.primary, borderRadius: BorderRadius.circular(17)),
                          child: const Icon(Icons.eco_rounded, size: 29, color: Colors.white),
                        ),
                      ),
                      const SizedBox(height: 24),
                      Text('Welcome back', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.7)),
                      const SizedBox(height: 7),
                      Text('Sign in to manage your grocery operations.', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: const Color(0xFF74847A))),
                      const SizedBox(height: 28),
                      TextFormField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.username],
                        decoration: const InputDecoration(labelText: 'Email address', prefixIcon: Icon(Icons.mail_outline_rounded)),
                        validator: (value) => value == null || !value.contains('@') ? 'Enter a valid email' : null,
                        onFieldSubmitted: (_) => _submit(),
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _password,
                        obscureText: true,
                        autofillHints: const [AutofillHints.password],
                        decoration: const InputDecoration(labelText: 'Password', prefixIcon: Icon(Icons.lock_outline_rounded)),
                        validator: (value) => value == null || value.isEmpty ? 'Enter your password' : null,
                        onFieldSubmitted: (_) => _submit(),
                      ),
                      const SizedBox(height: 20),
                      BlocBuilder<AuthCubit, AuthState>(
                        builder: (context, state) => SizedBox(
                          height: 50,
                          child: FilledButton(
                            onPressed: state is AuthLoading ? null : _submit,
                            child: state is AuthLoading
                                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                : const Text('Sign in', style: TextStyle(fontWeight: FontWeight.w700)),
                          ),
                        ),
                      ),
                      BlocBuilder<AuthCubit, AuthState>(
                        builder: (context, state) {
                          if (state is! Unauthenticated || state.error == null) return const SizedBox.shrink();
                          return Padding(
                            padding: const EdgeInsets.only(top: 14),
                            child: Text(state.error!, textAlign: TextAlign.center, style: TextStyle(color: colors.error)),
                          );
                        },
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
