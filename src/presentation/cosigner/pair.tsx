import { Field, Form, FormikProps, withFormik } from 'formik';
import React from 'react';
import Shell from '../components/shell';
import * as Yup from 'yup';
import Button from '../components/button';

interface OptInFormProps {
  onSubmit: (values: OptInFormValues) => Promise<void>;
}

interface OptInFormValues {
  cosignerURL: string;
}

const optInForm = (props: FormikProps<OptInFormValues>) => {
  const { touched, errors, isSubmitting } = props;

  const touchedAndError = (value: keyof OptInFormValues) => touched[value] && errors[value];

  return (
    <Form>
      <p className="mb-2">Cosigner URL</p>
      <Field
        type="url"
        name="cosignerURL"
        placeholder="https://cosignerurl.."
        className="focus:ring-primary focus:border-primary placeholder-grayLight block w-2/5 border-2 rounded-md"
      />
      {touchedAndError('cosignerURL') && <div className="text-red">{errors.cosignerURL}</div>}

      <Button className="mt-3 text-base" disabled={isSubmitting} type="submit">
        Pair with cosigner
      </Button>
    </Form>
  );
};

const OptInFormikForm = withFormik<OptInFormProps, OptInFormValues>({
  validationSchema: Yup.object().shape({
    cosignerURL: Yup.string().required('Please input cosignerURL').url('Not a valid URL'),
  }),

  handleSubmit: async (values, { props }) => {
    await props.onSubmit(values);
  },

  displayName: 'OptInForm',
})(optInForm);

const PairCosigner: React.FC = () => {
  const onSubmit = (values: OptInFormValues) => {
    console.log(values);
    return Promise.resolve();
  };

  return (
    <Shell>
      <h2 className="mb-4 text-3xl font-medium">Add a new 2-of-2 Account</h2>
      <OptInFormikForm onSubmit={onSubmit} />
    </Shell>
  );
};

export default PairCosigner;