interface InputFieldProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}

export default function InputField({ onChange, ...props }: InputFieldProps) {
  return (
    <input
      {...props}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
    />
  );
}
