function write_result(path, num, den, poles, t, y)
% Записывает результат проверки: коэффициенты ПФ, полюса и переходный процесс.
f = fopen(path, 'w');
fprintf(f, 'num'); fprintf(f, ',%.17g', num); fprintf(f, '\n');
fprintf(f, 'den'); fprintf(f, ',%.17g', den); fprintf(f, '\n');
fprintf(f, 'pole_re'); fprintf(f, ',%.17g', real(poles)); fprintf(f, '\n');
fprintf(f, 'pole_im'); fprintf(f, ',%.17g', imag(poles)); fprintf(f, '\n');
fprintf(f, 't'); fprintf(f, ',%.17g', t); fprintf(f, '\n');
fprintf(f, 'y'); fprintf(f, ',%.17g', y); fprintf(f, '\n');
fclose(f);
end
