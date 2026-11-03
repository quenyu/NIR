%% Проверка анализа (дипломная работа): те же схемы, что в Control Lab, считаются в MATLAB.
% Каждая система собирается здесь заново из передаточных функций (tf, ss, feedback),
% без матриц Control Lab. Результаты пишутся в CSV, затем
%   python scripts/vkr_verification.py
% сравнивает их с программой. Запуск: открыть папку backend/verification/vkr и выполнить vkr_analysis.
% Файлы matlab_vkr_*.csv появятся в этой же папке; их нужно положить в docs/study/.

if exist('OCTAVE_VERSION', 'builtin'), pkg load control; end
if ~exist('vkr_out', 'var'), vkr_out = ''; end
w = logspace(-2, 3, 60);

% --- Контур с ПИ-регулятором: Kп = 2, Kи = 1, объект 1/(s+1) · 1/(0,5s+1)
C = ss(tf([2 1], [1 0]));  G1 = ss(tf(1, [1 1]));  G2 = ss(tf(1, [0.5 1]));
L = G2*G1*C;
vkr_write([vkr_out 'matlab_vkr_pi.csv'], feedback(L, 1), L, w, true);

% --- Перекрёстные обратные связи: G1 = 1/(s+1), G2 = 2/(0,5s+1), G3 = 1/s, H1 = 0,5, H2 = 1
G1 = tf(1, [1 1]);  G2 = tf(2, [0.5 1]);  G3 = tf(1, [1 0]);  H1 = 0.5;  H2 = 1;
inner = feedback(G2*G3, H2);                    % контур H2 вокруг G2·G3
L = minreal(feedback(G1*inner, H1/G3), 1e-9);   % H1 снимается с выхода G2 = выход G3 / G3
vkr_write([vkr_out 'matlab_vkr_crossed.csv'], minreal(feedback(L, 1), 1e-9), L, w, true);

% --- ЭГСП 8-го порядка (параметры — задания к практическим занятиям 01–02 [ИУСУ], E = 1e7 Па)
s = tf('s');
k1 = 50;  a1 = 0.4;  a0 = 80;  b0 = 1;
c2 = 0.3e-6;  c1 = 7e-5;  c0 = 0.1;  d0 = 1;  k4 = 10;
k2 = 1e-3;  k3 = 1/1e-6;  g1 = 0.785e-4;
e2 = 0.005;  e1 = 0.25;  e0 = 2;  f0 = 0.785e-4;  k5 = 4.3;
h1 = 647e-6/(2*1e7);  h0 = 1e-10;  l0 = 1;  q1 = 1.99e-3;
n2 = 10;  n1 = 10;  n0 = 0;  r0 = 1.99e-3;  k6 = 0.1;
W01 = feedback(k3*f0/(e2*s^2 + e1*s + e0), g1*s);            % золотник
W02 = feedback(d0/(c2*s^2 + c1*s + c0)*k2*W01, k4);          % якорь ЭМП с механической обратной связью
W03 = feedback(l0/(h1*s + h0)*r0/(n2*s^2 + n1*s + n0), q1*s);  % гидроцилиндр с поршнем
forward = minreal(k1*b0/(a1*s + a0)*W02*k5*W03, 1e-9);
L = minreal(forward*k6, 1e-9);                               % разомкнутый главный контур
vkr_write([vkr_out 'matlab_vkr_egsp.csv'], minreal(feedback(forward, k6), 1e-9), L, logspace(0, 4, 60), true);

% --- Контур 3-го порядка K/(s(s+1)(s+2)): K = 2 (устойчив), K = 10 (неустойчив)
G = tf(1, [1 3 2 0]);
vkr_write([vkr_out 'matlab_vkr_k2.csv'], feedback(2*G, 1), 2*G, w, true);
vkr_write([vkr_out 'matlab_vkr_k10.csv'], feedback(10*G, 1), 10*G, w, false);

% --- Граничные случаи без обратной связи
vkr_write([vkr_out 'matlab_vkr_undamped.csv'], tf(1, [1 0 1]), [], w, false);
vkr_write([vkr_out 'matlab_vkr_double.csv'], tf(1, [1 0 0]), [], w, false);
% сокращение: 1/(s+1), затем (s+1)/(s+2); ss сохраняет оба состояния, minreal не применяется
vkr_write([vkr_out 'matlab_vkr_cancel.csv'], ss(tf([1 1], [1 2]))*ss(tf(1, [1 1])), [], w, true);

% --- Корневой годограф контура 3-го порядка по K
K = [0.5 1 2 4 6 8 10];
f = fopen([vkr_out 'matlab_vkr_sweep.csv'], 'w');
for k = K
    p = pole(feedback(k*G, 1));
    fprintf(f, '%.17g', k);  fprintf(f, ',%.17g', real(p));  fprintf(f, ',%.17g', imag(p));  fprintf(f, '\n');
end
fclose(f);
disp('Готово: matlab_vkr_*.csv');
